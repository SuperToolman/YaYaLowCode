"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, TextArea, toast } from "@heroui/react";
import { FaceRobot, PaperPlane } from "@gravity-ui/icons";
import { createAgentSession } from "../../../lib/api-client";
import { AgentMarkdown } from "../../../components/agent-markdown";
import { getFormComponentAgentCapability } from "../../../lib/form-component-agent-capabilities";
import { normalizeCascaderDataSource, serializeCascaderValue } from "../../../lib/cascader-data-source";
import { isCountryCityValue, normalizeCountryCityValue } from "../../../lib/location-catalog";
import type { RuntimeSchemaField } from "../../../components/runtime-form-renderer";

type SchemaField = RuntimeSchemaField;
type ApiEnvelope<T> = { code: number; data: T | null; message: string; time: string };
type FormAgentMessage = { id: string; role: "user" | "assistant"; content: string };

export function FormAgentPanel({ agentId, analysis, appId, currentValues, fields, formName, formUuid, onApplyValues, prompt }: { agentId: string; analysis: string; appId: string; currentValues: Record<string, unknown>; fields: SchemaField[]; formName: string; formUuid: string; onApplyValues: (values: Record<string, unknown>) => void; prompt: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<FormAgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [error, messages, streaming]);

  const context = { appId, formUuid, formDraftAssist: true, route: `/${appId}/${formUuid}` };

  async function createSession() {
    if (!agentId) throw new Error("当前表单尚未选择机器人");
    const { data, error } = await createAgentSession({
      body: { agentId, source: "form_fill", context },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) throw new Error(data?.message || "无法创建 Agent 会话");
    setSessionId(data.data.id);
    return data.data.id;
  }

  async function sendMessage(content = input) {
    const normalized = content.trim();
    if (!normalized || streaming) return;
    setInput("");
    setError("");
    setStreaming(true);
    sequence.current += 1;
    const messageId = sequence.current;
    const assistantId = `form-agent-assistant-${messageId}`;
    setMessages((current) => [...current, { id: `form-agent-user-${messageId}`, role: "user", content: normalized }, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const activeSessionId = sessionId ?? await createSession();
      const writableFields = fields.filter((field) => {
        const capability = getFormComponentAgentCapability(field.type);
        return capability.writable && !field.props?.isHidden && !field.props?.isDisabled && !field.props?.isReadOnly && field.props?.defaultValueType !== "formula";
      });
      const fieldContext = writableFields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        options: field.props?.options,
        agentCapability: getFormComponentAgentCapability(field.type),
      }));
      const businessContext = [
        `当前业务表单：${formName}（${formUuid}）`,
        prompt.trim() ? `表单业务说明：${prompt.trim()}` : "",
        analysis.trim() ? `发布前 Schema 分析结果：${analysis.trim()}` : "",
        `可填写字段：${JSON.stringify(fieldContext)}`,
        `当前未提交表单值：${JSON.stringify(currentValues)}`,
        "如果用户要求填写表单，请直接生成合适的字段值，不要先要求分析表单，也不要提交数据。请在正常回复末尾追加一个不可见标记，严格格式为：<!--FORM_VALUES:{\"字段ID\":\"字段值\"}-->。只包含需要填写或修改的字段。",
        `用户请求：${normalized}`,
      ].filter(Boolean).join("\n\n");
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(activeSessionId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ content: businessContext, context }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as ApiEnvelope<never>;
        throw new Error(payload.message || "Agent 请求失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        frames.forEach((frame) => { assistantContent += applyFormAgentFrame(frame, assistantId, setMessages); });
        if (done) {
          if (buffer.trim()) assistantContent += applyFormAgentFrame(buffer, assistantId, setMessages);
          break;
        }
      }
      const valuePatch = extractFormValuePatch(assistantContent, writableFields);
      if (Object.keys(valuePatch).length > 0) {
        onApplyValues(valuePatch);
        toast.success("Agent 已填写表单", { description: `已更新 ${Object.keys(valuePatch).length} 个字段，尚未提交。` });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Agent 请求失败";
      setError(message);
      setMessages((current) => current.map((item) => item.id === assistantId && !item.content ? { ...item, content: `Agent 运行失败：${message}` } : item));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <aside className="flex rounded-2xl h-full min-h-0 w-[420px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-control-soft)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-4 w-4" /></span>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">表单 Agent</div><div className="truncate text-xs text-[var(--color-text-secondary)]">协助处理 {formName}</div></div>
        </div>
      </div>
      <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-5 w-5" /></span>
            <p className="mt-3 text-sm font-medium">让 Agent 协助处理表单业务</p>
            <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--color-text-secondary)]">直接描述业务需求，例如“帮我填写这份申请表，但先不要提交”。</p>
          </div>
        ) : messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={message.role === "user" ? "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--color-primary-soft)] px-3 py-2 text-sm leading-6" : "w-full px-1 py-1 text-sm leading-7"}>
              {message.content ? (message.role === "assistant" ? <AgentMarkdown content={message.content} /> : message.content) : (streaming ? "正在思考…" : "")}
            </div>
          </div>
        ))}
        {error ? <p className="rounded-lg bg-[var(--color-danger-soft)] p-3 text-xs text-[var(--color-danger)]">{error}</p> : null}
      </div>
      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex items-end gap-2">
          <TextArea
            fullWidth
            rows={2}
            aria-label="向表单 Agent 提问"
            placeholder={agentId ? "描述需要 Agent 处理的业务…" : "请先在设计器中选择机器人"}
            value={input}
            disabled={!agentId || streaming}
            className="h-[58px] min-h-[58px] max-h-[58px] resize-none overflow-y-auto text-sm leading-5"
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <Button isIconOnly aria-label="发送消息" isDisabled={!agentId || !input.trim() || streaming} onPress={() => void sendMessage()}><PaperPlane className="h-4 w-4" /></Button>
        </div>
      </div>
    </aside>
  );
}

function applyFormAgentFrame(frame: string, assistantId: string, setMessages: Dispatch<SetStateAction<FormAgentMessage[]>>) {
  let eventName = "message";
  const dataLines: string[] = [];
  frame.split("\n").forEach((line) => {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  });
  if (dataLines.length === 0) return "";
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>; } catch { return ""; }
  if (eventName === "message.delta" && typeof payload.delta === "string") {
    setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + payload.delta } : message));
    return payload.delta;
  }
  if ((eventName === "run.failed" || eventName === "message.failed") && typeof payload.message === "string") {
    setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: `Agent 运行失败：${payload.message}` } : message));
  }
  return "";
}

function extractFormValuePatch(content: string, writableFields: SchemaField[]) {
  const match = content.match(/<!--FORM_VALUES:([\s\S]*?)-->/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const fieldMap = new Map(writableFields.map((field) => [field.id, field]));
    const entries: Array<[string, unknown]> = [];
    for (const [fieldId, value] of Object.entries(parsed)) {
      const field = fieldMap.get(fieldId);
      if (!field) continue;
      const normalized = normalizeAgentFieldValue(field, value);
      if (normalized.accepted) entries.push([fieldId, normalized.value]);
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function normalizeAgentFieldValue(field: SchemaField, value: unknown): { accepted: boolean; value: unknown } {
  const capability = getFormComponentAgentCapability(field.type);
  if (!capability.writable) return { accepted: false, value: undefined };
  const optionValues = new Set((field.props?.options ?? []).map((option) => option.value));

  if (field.type === "countryCity") {
    return isCountryCityValue(value)
      ? { accepted: true, value: normalizeCountryCityValue(value) }
      : { accepted: false, value: undefined };
  }

  if (field.type === "cascader") {
    const values = new Set<string>();
    const collectLeaves = (
      items: ReturnType<typeof normalizeCascaderDataSource>,
      parentPath: ReturnType<typeof normalizeCascaderDataSource>,
    ) => {
      for (const item of items) {
        const currentPath = [...parentPath, item];
        if (item.children?.length) {
          collectLeaves(item.children, currentPath);
        } else {
          values.add(serializeCascaderValue(currentPath));
        }
      }
    };
    collectLeaves(normalizeCascaderDataSource(field.props?.dataSource), []);
    return typeof value === "string" && values.has(value)
      ? { accepted: true, value }
      : { accepted: false, value: undefined };
  }

  if (capability.valueType === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numberValue)) return { accepted: false, value: undefined };
    if (typeof field.props?.minValue === "number" && numberValue < field.props.minValue) return { accepted: false, value: undefined };
    if (typeof field.props?.maxValue === "number" && numberValue > field.props.maxValue) return { accepted: false, value: undefined };
    return { accepted: true, value: numberValue };
  }

  if (capability.valueType === "string[]") {
    if (!Array.isArray(value)) return { accepted: false, value: undefined };
    const values = value.filter((item): item is string => typeof item === "string");
    if (values.length !== value.length) return { accepted: false, value: undefined };
    if (optionValues.size > 0 && values.some((item) => !optionValues.has(item))) return { accepted: false, value: undefined };
    return { accepted: true, value: values };
  }

  if (capability.valueType === "dateRange") {
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item))) return { accepted: false, value: undefined };
    return { accepted: true, value };
  }

  if (capability.valueType === "date") {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? { accepted: true, value }
      : { accepted: false, value: undefined };
  }

  if (capability.valueType === "string") {
    if (typeof value !== "string") return { accepted: false, value: undefined };
    if (optionValues.size > 0 && !optionValues.has(value)) return { accepted: false, value: undefined };
    return { accepted: true, value };
  }

  if (capability.valueType === "boolean" && typeof value === "boolean") return { accepted: true, value };
  return { accepted: false, value: undefined };
}

