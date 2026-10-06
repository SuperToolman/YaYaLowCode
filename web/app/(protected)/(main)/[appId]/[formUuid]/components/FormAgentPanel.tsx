"use client";
import { notify } from "@lib/notify";

import { useEffect, useMemo, useRef, useState } from "react";
import { FaceRobot } from "@gravity-ui/icons";
import { AgentMessage, AgentMessageComposer } from "@features/agent-assistant/components";
import { getFormComponentAgentCapability } from "@lib/form-component-agent-capabilities";
import type { RuntimeSchemaField } from "@/features/form-runtime/types";
import { useAgentWorkbenchRuntime } from "@/features/agent-workbench/runtime";
import { uploadAgentFile } from "@/features/agent-workbench/platform-api";

type SchemaField = RuntimeSchemaField;

export function FormAgentPanel({ agentId, appId, currentValues, fields, formName, formUuid, onApplyValues, prompt }: { agentId: string; appId: string; currentValues: Record<string, unknown>; fields: SchemaField[]; formName: string; formUuid: string; onApplyValues: (values: Record<string, unknown>) => void; prompt: string }) {
  const runtime = useAgentWorkbenchRuntime();
  const [input, setInput] = useState(prompt);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<Array<{ file: File; key: string }>>([]);
  const seenProposalSeq = useRef(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const state = sessionId ? runtime.states[sessionId] : undefined;
  const messages = state?.messages ?? [];
  const streaming = state?.runStatus === "thinking" || state?.runStatus === "working" || state?.runStatus === "responding";
  const writableFields = useMemo(() => fields.filter(field => { const capability = getFormComponentAgentCapability(field.type); return capability.writable && !field.props?.isHidden && !field.props?.isDisabled && !field.props?.isReadOnly && field.props?.defaultValueType !== "formula"; }), [fields]);

  useEffect(() => { setSessionId(null); setError(""); setFiles([]); seenProposalSeq.current = -1; }, [agentId, appId, formUuid]);
  useEffect(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; }, [messages, error]);
  useEffect(() => {
    const event = state?.canonicalEvents.at(-1);
    if (!event || event.seq <= seenProposalSeq.current || event.type !== "tool/result") return;
    seenProposalSeq.current = event.seq;
    const source = event.data.message ?? event.data;
    const content = typeof source === "object" && source !== null && "content" in source ? (source as { content?: unknown }).content : source;
    const raw = typeof content === "string" ? content : JSON.stringify(content);
    try {
      const proposal = JSON.parse(raw) as { type?: string; values?: Record<string, unknown> };
      if (proposal.type !== "form_values_proposal" || !proposal.values) return;
      const patch = Object.fromEntries(Object.entries(proposal.values).filter(([id]) => writableFields.some(field => field.id === id)));
      if (!Object.keys(patch).length) return;
      onApplyValues(patch);
      notify.success("Agent 已填写表单", { description: `已更新 ${Object.keys(patch).length} 个字段，尚未提交。` });
    } catch { /* This tool result is not a form proposal. */ }
  }, [state?.canonicalEvents, onApplyValues, writableFields]);

  async function sendMessage() {
    const request = input.trim(); if (!request || streaming) return;
    setError(""); setInput("");
    try {
      const activeSessionId = sessionId ?? await runtime.create({ agentId, source: "form_fill", context: { appId, formUuid, formDraftAssist: true, route: `/${appId}/${formUuid}` } });
      setSessionId(activeSessionId);
      const uploaded = await Promise.all(files.map(async ({ file }) => uploadAgentFile(activeSessionId, file)));
      const values = Object.fromEntries(Object.entries(currentValues).filter(([, value]) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)));
      const businessContext = [
        `当前业务表单：${formName}`,
        `应用 ID：${appId}`,
        `表单 ID：${formUuid}`,
        Object.keys(values).length ? `当前已有值（仅非空）：${JSON.stringify(values)}` : "当前表单为空",
        "请先调用 yaya_get_form_schema 读取当前表单的最新 Schema。若用户要求回填，请调用 yaya_propose_form_values 返回候选值，不要提交表单；字段 key 必须使用工具返回的真实字段 id。",
        uploaded.length ? `本次请求已附加文件（通过受控附件工具读取）：${uploaded.map(file => file.name).join("、")}` : "",
        `用户请求：${request}`,
      ].filter(Boolean).join("\n\n");
      await runtime.prompt(activeSessionId, businessContext);
      setFiles([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent 请求失败"); }
  }

  return <aside className="flex h-full min-h-0 w-[420px] shrink-0 flex-col rounded-2xl border-l border-[var(--color-border)] bg-[var(--color-control-soft)]">
    <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-4 w-4" /></span><div className="min-w-0"><div className="truncate text-sm font-semibold">表单 Agent</div><div className="truncate text-xs text-[var(--color-text-secondary)]">协助处理 {formName}</div></div></div>
    <div ref={containerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">{messages.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center text-center"><FaceRobot className="h-5 w-5 text-[var(--color-primary)]" /><p className="mt-3 text-sm font-medium">让 Agent 协助处理表单业务</p><p className="mt-2 max-w-xs text-xs leading-5 text-[var(--color-text-secondary)]">直接描述业务需求，例如“帮我填写这份申请表，但先不要提交”。</p></div> : messages.map(message => <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}><div className={message.role === "user" ? "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--color-primary-soft)] px-3 py-2 text-sm leading-6" : "w-full px-1 py-1 text-sm leading-7"}><AgentMessage message={message} loading={streaming && message.role === "assistant"} /></div></div>)}{error ? <p className="rounded-lg bg-[var(--color-danger-soft)] p-3 text-xs text-[var(--color-danger)]">{error}</p> : null}</div>
    <div className="border-t border-[var(--color-border)] p-3"><AgentMessageComposer value={input} files={files} loading={streaming || Boolean(state?.command)} error={error} onChange={setInput} onFilesSelect={(selected) => { const valid = selected.filter(file => file.size <= 50 * 1024 * 1024); if (valid.length !== selected.length) setError("单个附件不能超过 50 MB"); setFiles(current => [...current, ...valid.map(file => ({ file, key: crypto.randomUUID() }))]); }} onFileRemove={(key) => setFiles(current => current.filter(item => item.key !== key))} onSend={() => void sendMessage()} /></div>
  </aside>;
}
