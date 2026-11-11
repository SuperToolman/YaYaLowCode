"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listModelRoutes } from "@/features/settings/api";
import type { ModelRouteResponse } from "@/shared/lib/http";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { forkSession, readSession, updateSession, type SessionUpdate, listEmployees, listMessages, listConfirmations, submitCommand, listWorkspaceFiles, listFilePreviews, listExecutions, type ExecutionRecord, type FilePreview, type WorkspaceFile, type AgentEvent, type Employee, type Message, type Session, type Confirmation } from "./client";
import { conversationMessages, runStatus } from "./runtime-core";
import { useSessionDirectory } from "./session-directory";
import { notifyRequestError } from "@/shared/lib/notify";
import { useSubmissionFlow, type LocalAttachment } from "./submission-flow";

export function useAgentV2Workspace() {
  const { user, permissionsReady, hasPermission } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const [nextBefore,setNextBefore]=useState<string | null>(null);
  const [loadingOlder,setLoadingOlder]=useState(false);
  const olderRequest=useRef(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [executions,setExecutions]=useState<ExecutionRecord[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [workspaceFiles,setWorkspaceFiles]=useState<WorkspaceFile[]>([]);
  const [attachments,setAttachments]=useState<LocalAttachment[]>([]);
  const pendingAttachments = useRef<LocalAttachment[]>([]);
  const replaceAttachments = useCallback((items: LocalAttachment[]) => {
    pendingAttachments.current = items;
    setAttachments(items);
  }, []);

  const decisionKeys = useRef(new Map<string, string>());
  const [modelRoutes,setModelRoutes]=useState<ModelRouteResponse[]>([]);
  const [modelKey,setModelKey]=useState("");
  const [reasoningEffort,setReasoningEffort]=useState("auto");
  const [knowledgeBaseIds,setKnowledgeBaseIds]=useState<string[]>([]);
  const modelOptions=modelRoutes.filter(route=>route.enabled && route.providerType === "chat").filter(route=>route.model.trim()).map(route=>({id:JSON.stringify([route.id,route.model]),label:`${route.name} · ${route.model}`,route,model:route.model}));
  const selectedModel=modelOptions.find(option=>option.id===modelKey) ?? modelOptions.find(option=>option.route.isDefault) ?? modelOptions[0];
  const effortOptions = !selectedModel?.route.thinkingEnabled ? ["auto"] : ["auto", "off", ...(selectedModel.route.reasoningProtocol === "qwen" ? [] : selectedModel.route.reasoningProtocol === "deepseek" ? ["high", "extreme"] : ["low", "medium", "high", "ultra", "extreme"])];
  const effectiveEffort=effortOptions.includes(reasoningEffort) ? reasoningEffort : "auto";
  function selectModel(key:string){setModelKey(key);setReasoningEffort("auto");}
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const currentSession = useRef("");
  useEffect(() => { currentSession.current = sessionId; }, [sessionId]);
  const allowed = permissionsReady && hasPermission("agent.window");
  const directory = useSessionDirectory(allowed, employeeId);
  const {sessions, refreshDirectory} = directory;
  useEffect(()=>{ if(!allowed)return;const controller=new AbortController();void listModelRoutes().then(routes=>{if(!controller.signal.aborted)setModelRoutes(routes);}).catch(()=>{if(!controller.signal.aborted)setError("无法加载模型供应商，请检查模型配置");});return ()=>controller.abort();},[allowed]);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const flow = useSubmissionFlow({
    userId: user?.id ?? "", ready: allowed,
    restore: (input, files) => { setKnowledgeBaseIds(input.knowledgeBaseIds ?? []); if(input.routeId && input.model)setModelKey(JSON.stringify([input.routeId,input.model]));setReasoningEffort(input.reasoningEffort ?? "auto"); setEmployeeId(input.employeeId); currentSession.current=input.sessionId ?? "";setSessionId(input.sessionId ?? "");setDraft(input.text);replaceAttachments(files); },
    complete: async result => {
      currentSession.current=result.sessionId;setSessionId(result.sessionId);
      setDraft("");replaceAttachments([]);setError("");
      try {
        const history=await listMessages(result.sessionId);if(currentSession.current===result.sessionId){setMessages(items=>mergeHistory(items,history.items));if(!historyLoaded)setNextBefore(history.next_before ?? null);setHistoryLoaded(true);}
        await refreshDirectory();
      } catch { if(currentSession.current===result.sessionId)setError("消息已提交，历史加载失败，请重新打开会话"); }
    },
    error: setError,
  });
  const uploading=flow.phase === "正在上传附件";
  const operationBusy=busy || flow.active;

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void listEmployees(controller.signal)
      .then(staff => { if (!controller.signal.aborted) {setEmployees(staff.items); setEmployeeId(id => id || staff.items[0]?.id || "");} })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "加载失败"); });
    const refreshEmployees = () => {
      void listEmployees(controller.signal).then(staff => {
        if (!controller.signal.aborted) setEmployees(staff.items);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "员工更新失败"); });
    };
    window.addEventListener("yaya-ai-employees-updated", refreshEmployees);
    window.addEventListener("focus", refreshEmployees);
    return () => {
      controller.abort();
      window.removeEventListener("yaya-ai-employees-updated", refreshEmployees);
      window.removeEventListener("focus", refreshEmployees);
    };
  }, [allowed]);

  useEffect(() => {
    if (!sessionId || !allowed) return;
    const controller = new AbortController();
    let source: EventSource | undefined;
    let historyVersion = 0;
    const usagePoll=window.setInterval(()=>{
      const version=++historyVersion;
      void listMessages(sessionId,controller.signal).then(value=>{
        if(!controller.signal.aborted && currentSession.current===sessionId && version===historyVersion) {setMessages(items=>mergeHistory(items,value.items));}
      }).catch(()=>undefined);
    },10000);
    const refreshExecutions=()=>void listExecutions(sessionId,controller.signal).then(value=>{if(!controller.signal.aborted && currentSession.current===sessionId)setExecutions(value.items);}).catch(()=>undefined);
    refreshExecutions();
    void Promise.all([listMessages(sessionId, controller.signal), listConfirmations(sessionId, controller.signal), listWorkspaceFiles(sessionId,controller.signal), listFilePreviews(sessionId,controller.signal), readSession(sessionId,controller.signal)]).then(([result, decisions, files, previews, metadata]) => {
      if (controller.signal.aborted || currentSession.current !== sessionId) return;
      setSelectedSession(metadata);
      setMessages(result.items);

      setNextBefore(result.next_before ?? null);
      setHistoryLoaded(true);
      setEvents((result.events ?? []) as AgentEvent[]);
      setConfirmations(decisions.items);
      setWorkspaceFiles(files.items);
      setFilePreviews(previews.items);
      source = new EventSource(`/api/agent/v2/sessions/${sessionId}/events?after=${result.event_cursor ?? 0}`);
      source.onopen = () => {
        if (controller.signal.aborted || currentSession.current !== sessionId) return;
        setConnected(true);
        refreshExecutions();
        void listWorkspaceFiles(sessionId,controller.signal).then(value=>{if(!controller.signal.aborted)setWorkspaceFiles(value.items);}).catch(()=>undefined);
        void listConfirmations(sessionId, controller.signal).then(value => { if (!controller.signal.aborted) setConfirmations(value.items); }).catch(() => undefined);
      };
      source.onerror = () => { if (!controller.signal.aborted && currentSession.current === sessionId) setConnected(false); };
      source.addEventListener("access_revoked", () => { if (controller.signal.aborted || currentSession.current !== sessionId) return; source?.close(); controller.abort(); currentSession.current=""; setExecutions([]); setConnected(false); setMessages([]); setEvents([]); setConfirmations([]); setWorkspaceFiles([]); replaceAttachments([]); setError("当前会话访问权限已失效"); });
      source.onmessage = event => {
        if (controller.signal.aborted || currentSession.current !== sessionId) return;
        try {
          const frame = JSON.parse(event.data) as AgentEvent;
          if(frame.type === "session.updated" || frame.type.startsWith("run.")) {
            void refreshDirectory().catch(() => undefined);
            void readSession(sessionId,controller.signal).then(value=>{if(!controller.signal.aborted)setSelectedSession(value);}).catch(()=>undefined);
          }
          if(frame.type.startsWith("execution.")) refreshExecutions();
          if (frame.type.startsWith("attachment.")) void listFilePreviews(sessionId,controller.signal).then(value=>{if(!controller.signal.aborted)setFilePreviews(value.items);}).catch(()=>undefined);
          if(frame.type === "workspace.file.created") void listWorkspaceFiles(sessionId,controller.signal).then(value=>{if(!controller.signal.aborted)setWorkspaceFiles(value.items);}).catch(()=>undefined);
          setEvents(items => items.some(item => item.seq === frame.seq) ? items : [...items, frame].sort((a, b) => a.seq - b.seq));
          if (frame.type.startsWith("confirmation.") || frame.type === "run.cancelled") {
            void listConfirmations(sessionId, controller.signal).then(value => {if (!controller.signal.aborted) setConfirmations(value.items);}).catch(reason => {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "确认状态加载失败");});
          }
          if (["model.usage", "step.completed", "run.paused", "run.manual_review", "run.resumed", "run.stage_completed", "run.waiting_confirmation", "run.completed", "run.failed", "run.cancelled", "run.queued"].includes(frame.type)) {
            void refreshDirectory().catch(() => undefined);
            const version = ++historyVersion;
            void listMessages(sessionId, controller.signal).then(value => { if (!controller.signal.aborted && version === historyVersion) {setMessages(items=>mergeHistory(items,value.items));setEvents(items=>mergeEvents(items,(value.events ?? []) as AgentEvent[]));} }).catch(() => undefined);
          }
        } catch { setError("收到无效事件，请刷新会话"); }
      };
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "加载历史失败"); });
    return () => { window.clearInterval(usagePoll); controller.abort(); source?.close(); };
  }, [sessionId, allowed, refreshDirectory, replaceAttachments]);

  function selectSession(id: string) {
    if (flow.frozen || flow.active) return;
    if (id && id === currentSession.current) return;
    currentSession.current=id;
    setSelectedSession(sessions.find(item=>item.id===id) ?? null);
    setExecutions([]);
    setHistoryLoaded(false);setNextBefore(null);setLoadingOlder(false);olderRequest.current=false;
    setSessionId(id); setMessages([]); setEvents([]); setConfirmations([]); setWorkspaceFiles([]); replaceAttachments([]); setConnected(false);
    setDraft(""); setError(""); setFilePreviews([]);
  }

  function create() {
    if (!employeeId || operationBusy || flow.frozen) return;
    selectSession("");
  }
  async function send() {
    const text=draft.trim();
    if (operationBusy || selectedSession?.archived_at || (!text && !attachments.length)) return;
    await flow.send(employeeId,sessionId,text,pendingAttachments.current,{routeId:selectedModel?.route.id,model:selectedModel?.model,reasoningEffort:effectiveEffort,knowledgeBaseIds});
  }
  async function forkFrom(messageId: string, clientRequestId: string) {
    if (!sessionId || operationBusy || flow.frozen) return false;
    const source=sessionId;
    setBusy(true);
    try {
      const target=await forkSession(source,messageId,clientRequestId);
      if(currentSession.current===source){selectSession(target.id);setSelectedSession(target);}
      await refreshDirectory();
      return true;
    } catch(reason){notifyRequestError(reason,reason instanceof Error?reason.message:"分叉失败，可重试");return false;}
    finally{setBusy(false);}
  }
  async function changeSession(patch: Omit<SessionUpdate,"expectedVersion">) {
    if (!sessionId || !selectedSession || operationBusy || flow.frozen) return false;
    const target=sessionId;
    setBusy(true);
    try {
      const value=await updateSession(target,{...patch,expectedVersion:selectedSession.metadata_version ?? 0});
      if (currentSession.current===target) {
        setSelectedSession(value);
        if(patch.archived!==undefined) selectSession("");
      }
      await refreshDirectory();
      return true;
    } catch(reason) {
      notifyRequestError(reason,reason instanceof Error ? reason.message : "修改会话失败");
      void readSession(target).then(value=>{if(currentSession.current===target)setSelectedSession(value);}).catch(()=>undefined);
      return false;
    } finally {setBusy(false);}
  }
  async function cancel() {
    setBusy(true); setError("");
    try { await submitCommand(sessionId, { kind: "cancel", clientCommandId: crypto.randomUUID() }); await refreshDirectory(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "停止失败"); }
    finally { setBusy(false); }
  }

  async function decide(confirmationId: string, approve: boolean) {
    if (busy || !sessionId) return;
    const target = sessionId;
    const key = `${confirmationId}:${approve}`;
    let clientCommandId = decisionKeys.current.get(key);
    if (!clientCommandId) {clientCommandId = crypto.randomUUID(); decisionKeys.current.set(key, clientCommandId);}
    setBusy(true); setError("");
    try {
      await submitCommand(target, {kind: "confirm", clientCommandId, confirmationId, approve});
      const value = await listConfirmations(target);
      if (currentSession.current === target) setConfirmations(value.items);
      await refreshDirectory();
    } catch (reason) {setError(reason instanceof Error ? reason.message : "确认失败，可重试");}
    finally {setBusy(false);}
  }

  async function uploadFiles(files: File[]) {
    if(operationBusy || !employeeId || !files.length) return;
    if (flow.frozen) {
      try {const matched=await flow.matchFiles(files);if(matched)replaceAttachments(pendingAttachments.current.map(file=>matched.find(item=>item.id===file.id) ?? file));setError("");}
      catch(reason){setError(reason instanceof Error?reason.message:"附件不匹配");}
      return;
    }
    const pending = pendingAttachments.current;
    if(files.length+pending.length>8 || files.some(file=>file.size===0 || file.size>8*1024*1024) || files.reduce((sum,f)=>sum+f.size,0)+pending.reduce((sum,f)=>sum+f.size,0)>16*1024*1024) {
      setError("每条消息最多 8 个附件、合计 16 MiB；单文件为 1 字节至 8 MiB");return;
    }
    replaceAttachments([...pending, ...files.map(file => ({
      id: crypto.randomUUID(), name: file.name, size: file.size, mimeType: file.type, file,
    }))]);
    setError("");
  }
  function removeAttachment(id:string){if(flow.frozen || operationBusy)return;replaceAttachments(pendingAttachments.current.filter(item=>item.id!==id));}

  async function loadOlder() {
    if (!sessionId || !nextBefore || olderRequest.current) return;
    const target=sessionId;
    olderRequest.current=true;setLoadingOlder(true);
    try {
      const page=await listMessages(target,undefined,nextBefore);
      if(currentSession.current!==target)return;
      setMessages(items=>mergeHistory(page.items,items));
      setEvents(items=>mergeEvents((page.events ?? []) as AgentEvent[],items));
      setNextBefore(page.next_before ?? null);
    } catch(reason){if(currentSession.current===target)setError(reason instanceof Error?reason.message:"历史消息加载失败，可重试");}
    finally {if(currentSession.current===target){olderRequest.current=false;setLoadingOlder(false);}}
  }
  const runIds=new Set([...messages.map(message=>message.run_id),...events.filter(event=>event.type.startsWith("run.")).map(event=>event.run_id)].filter((id):id is string=>Boolean(id)));
  const knownRuns=[...runIds].filter(id=>messages.some(message=>message.run_id===id && message.run_status) || events.some(event=>event.run_id===id && event.type.startsWith("run.")));
  const active=(status:string)=>!["completed","failed","stopped"].includes(status);
  const running = Boolean(sessionId && (knownRuns.length ? knownRuns.some(id=>active(runStatus(events.filter(event=>event.run_id===id),messages.find(message=>message.run_id===id)?.run_status))) : ["queued","running","retry_wait","waiting_confirmation","cancel_requested"].includes(sessions.find(session=>session.id===sessionId)?.run_status ?? "")));
  const conversation = conversationMessages(messages, events, workspaceFiles, executions);
  const selectedEmployee = employees.find(employee => employee.id === employeeId);

  return { knowledgeBaseIds,setKnowledgeBaseIds, directory, selectedSession, changeSession, forkFrom, modelOptions,selectedModel,selectModel,effortOptions,reasoningEffort:effectiveEffort,setReasoningEffort, runProgress: messages.filter(m=>m.role==="user" && m.run_progress).map(m=>({runId:m.run_id,...m.run_progress!})), historyLoaded,hasOlder:Boolean(nextBefore),loadingOlder,loadOlder, filePreviews, sendPhase: flow.phase, frozen: flow.frozen, abandonSend: flow.abandon, workspaceFiles, attachments: attachments.map(file=>({...file,status:flow.states[file.id] ?? file.status})), uploading, uploadFiles, removeAttachment, confirmations, decide, permissionsReady, allowed, employees, employeeId, sessions, sessionId, draft, error, busy: operationBusy, connected, running, conversation, selectedEmployee, events, setEmployeeId, setDraft, selectSession, create, send, cancel };
}

/** Latest pages replace their own turns without dropping previously loaded history. */
function mergeHistory(older:Message[],latest:Message[]):Message[]{
  const runs=new Set(latest.map(message=>message.run_id));
  return [...older.filter(message=>!runs.has(message.run_id)),...latest];
}
function mergeEvents(older:AgentEvent[],latest:AgentEvent[]):AgentEvent[]{
  return [...new Map([...older,...latest].map(event=>[event.seq,event])).values()].sort((a,b)=>a.seq-b.seq);
}
