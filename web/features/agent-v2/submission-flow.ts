"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { abandonSubmission, commitSubmission, createSubmission, getSubmission, uploadStagedFile, type Submission, type SubmissionInput } from "./client";
import type { SubmissionResult } from "@/shared/lib/http";

export type LocalAttachment = { id: string; name: string; size: number; file?: File; status?: string };
type Pending = { input: SubmissionInput; id?: string };
export const recoveryKey = (user: string) => `yaya-agent-v2-send:${user}`;
const save = (user: string, pending: Pending | null) => {
  if (!user) return;
  try {
    if (pending) localStorage.setItem(recoveryKey(user), JSON.stringify(pending));
    else localStorage.removeItem(recoveryKey(user));
  } catch {
    if(pending)throw new Error("无法保存发送恢复信息，请允许浏览器本地存储后重试");
  }
};
export async function fileHash(file: File) {
  const bytes = typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(new Error("无法读取附件"));reader.readAsArrayBuffer(file);
  });
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
}
export function useSubmissionFlow(options: {
  userId: string; ready: boolean;
  restore: (input: SubmissionInput, files: LocalAttachment[]) => void;
  complete: (result: SubmissionResult) => Promise<void>;
  error: (message: string) => void;
}) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const pending = useRef<Pending | null>(null);
  const locked = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(()=>{
    alive.current=true;
    const token=generation;
    return ()=>{alive.current=false;token.current+=1;uploadController.current?.abort();};
  },[]);
  const [phase, setPhase] = useState("");
  const [frozen, setFrozen] = useState(false);
  const [states, setStates] = useState<Record<string, string>>({});
  const persist = useCallback((value: Pending | null) => {
    if(!alive.current)return;
    save(latest.current.userId, value);pending.current = value; setFrozen(Boolean(value));
  }, []);
  const finish = useCallback(async (value: Submission) => {
    if (!alive.current || value.status !== "committed" || !value.result) return false;
    // Submission phases end here; durable run state owns queued/running/terminal UI.
    persist(null); setStates({}); setPhase("");
    await latest.current.complete(value.result);
    return true;
  }, [persist]);
  useEffect(() => {
    if (!options.ready || !options.userId) return;
    let disposed = false;
    let raw: Pending | null = null;
    try { raw = JSON.parse(localStorage.getItem(recoveryKey(options.userId)) ?? "null"); } catch { save(options.userId, null); }
    if (!raw?.input) return;
    pending.current = raw; locked.current = true;
    // Preserve a visible retry/abandon handle even if the recovery lookup fails.
    setTimeout(() => { if (!disposed && pending.current) { setFrozen(true); setPhase(old=>old || "正在恢复发送");
      if (pending.current === raw) latest.current.restore(raw.input,raw.input.attachments.map(f=>({id:f.clientFileId,name:f.name,size:f.size,status:"等待恢复"})));
    } }, 0);
    void (async () => {
      try {
        const value = raw.id ? await getSubmission(raw.id) : await createSubmission(raw.input);
        if (disposed) return;
        persist({ input: value.payload, id: value.id });
        if (await finish(value)) return;
        if (value.status !== "uploading") { persist(null); throw new Error("发送请求已过期或放弃，请重新发送"); }
        const uploaded = new Set(value.attachments.filter(f => f.uploaded).map(f => f.clientFileId));
        latest.current.restore(value.payload, value.payload.attachments.map(f => ({ id: f.clientFileId, name: f.name, size: f.size, status: uploaded.has(f.clientFileId) ? "已上传" : "请重新选择文件" })));
        setStates(Object.fromEntries(value.payload.attachments.map(f => [f.clientFileId, uploaded.has(f.clientFileId) ? "已上传" : "请重新选择文件"])));
        if (uploaded.size === value.payload.attachments.length) {
          setPhase("正在提交"); await finish(await commitSubmission(value.id));
        } else setPhase("等待重新选择缺失附件");
      } catch (error) { if (!disposed) { setPhase("恢复失败，可重试"); latest.current.error(error instanceof Error ? error.message : "恢复失败"); } }
      finally { locked.current = false; }
    })();
    return () => { disposed = true; uploadController.current?.abort(); };
  }, [options.ready, options.userId, persist, finish]);

  async function send(employeeId: string, sessionId: string, text: string, files: LocalAttachment[], selection: Pick<SubmissionInput, "routeId" | "model" | "reasoningEffort" | "knowledgeBaseIds"> = {}) {
    if (locked.current) return;
    const operation = ++generation.current;
    locked.current = true; setPhase("正在准备"); latest.current.error("");
    try {
      let current = pending.current;
      if (!current) {
        const input: SubmissionInput = { clientRequestId: crypto.randomUUID(), employeeId, sessionId: sessionId || null, text, attachments: [], ...selection };
        for (const f of files) {
          if (!f.file) throw new Error(`请重新选择附件 ${f.name}`);
          input.attachments.push({ clientFileId: f.id, name: f.name, size: f.size, sha256: await fileHash(f.file) });
        }
        if(operation!==generation.current)return;
        current = { input }; persist(current);
      }
      let value = current.id ? await getSubmission(current.id) : await createSubmission(current.input);
      if(operation!==generation.current)return;
      persist({ input: current.input, id: value.id });
      if (operation !== generation.current) return;
      if (await finish(value)) return;
      if (value.status !== "uploading") throw new Error("发送请求已失效，请先放弃本次发送");
      const uploaded = new Set(value.attachments.filter(f => f.uploaded).map(f => f.clientFileId));
      const waiting = current.input.attachments.filter(f => !uploaded.has(f.clientFileId));
      const controller = new AbortController(); uploadController.current = controller;
      let next = 0; let failure: unknown;
      setPhase(waiting.length ? "正在上传附件" : "正在提交");
      setStates(Object.fromEntries(current.input.attachments.map(f => [f.clientFileId, uploaded.has(f.clientFileId) ? "已上传" : "等待上传"])));
      const upload = async () => {
        while (next < waiting.length && !failure && !controller.signal.aborted) {
          const item = waiting[next++];
          try {
            const local = files.find(f => f.id === item.clientFileId)?.file;
            if (!local || local.name !== item.name || local.size !== item.size || await fileHash(local) !== item.sha256) throw new Error(`请重新选择匹配的附件 ${item.name}`);
            setStates(old => ({ ...old, [item.clientFileId]: "上传中" }));
            await uploadStagedFile(value.id, item.clientFileId, local, controller.signal);
            if(operation!==generation.current)return;
            setStates(old => ({ ...old, [item.clientFileId]: "已上传" }));
          } catch (error) { failure = error; if(operation===generation.current)setStates(old => ({ ...old, [item.clientFileId]: "上传失败" })); }
        }
      };
      await Promise.all([upload(), upload()]);
      if (operation !== generation.current) return;
      if (failure) throw failure;
      if (controller.signal.aborted) throw new Error("上传已停止，请放弃或重试");
      setPhase("正在提交");
      value = await commitSubmission(value.id);
      if (operation !== generation.current) return;
      if (!await finish(value)) throw new Error("服务端尚未确认提交，请重试查询");
    } catch (error) { if(operation === generation.current) {setPhase("发送失败，可重试"); latest.current.error(error instanceof Error ? error.message : "发送失败，可重试");} }
    finally { if(operation === generation.current){locked.current = false; uploadController.current = null;} }
  }
  async function abandon() {
    uploadController.current?.abort();
    if (locked.current && !uploadController.current) return;
    ++generation.current;
    locked.current = true;
    try {
      const current = pending.current;
      if (current) {
        const value = current.id ? await getSubmission(current.id) : await createSubmission(current.input);
        const resolved = await abandonSubmission(value.id);
        if (await finish(resolved)) return;
      }
      persist(null); setStates({}); setPhase(""); latest.current.error("");
    } catch (error) { setPhase("状态确认失败，可重试"); latest.current.error(error instanceof Error ? error.message : "无法确认发送状态，请重试"); }
    finally { locked.current = false; }
  }
  async function matchFiles(files: File[]) {
    if (!pending.current || locked.current) return null;
    const matched: LocalAttachment[] = [];
    for (const file of files) {
      const hash = await fileHash(file);
      const item = pending.current.input.attachments.find(f => f.name === file.name && f.size === file.size && f.sha256 === hash);
      if (!item) throw new Error(`附件 ${file.name} 与冻结清单不匹配`);
      matched.push({ id: item.clientFileId, name: item.name, size: item.size, file });
      setStates(old=>({...old,[item.clientFileId]:"等待上传"}));
    }
    return matched;
  }
  const active = ["正在准备", "正在恢复发送", "正在上传附件", "正在提交"].includes(phase);
  return { send, abandon, matchFiles, phase, frozen, active, states };
}
