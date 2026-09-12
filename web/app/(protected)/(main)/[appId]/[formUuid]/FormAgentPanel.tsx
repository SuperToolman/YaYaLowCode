"use client";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "@heroui/react";
import { FaceRobot } from "@gravity-ui/icons";
import { AgentMarkdown } from "../../../../components/agent/AgentMarkdown";
import { getFormComponentAgentCapability } from "../../../../lib/form-component-agent-capabilities";
import {
  normalizeCascaderDataSource,
  serializeCascaderValue,
} from "../../../../lib/cascader-data-source";
import {
  isCountryCityValue,
  normalizeCountryCityValue,
} from "../../../../lib/location-catalog";
import type { RuntimeSchemaField } from "@/features/form-runtime/types";
import {
  createAgentSessionData,
  openAgentMessageStream,
  updateAgentSessionData,
} from "@/features/agent-assistant/api";
import { parseAgentSseFrame } from "@/features/agent-assistant/sse";
import { AgentMessageComposer } from "../../../../components/agent/AgentMessageComposer";
import { AgentMessage } from "../../../../components/agent/AgentMessage";
import type {
  AgentMessage as AgentMessageType,
  AgentTimelineItem,
} from "@/features/agent-assistant/types";
type SchemaField = RuntimeSchemaField;
type FormAgentMessage = AgentMessageType;
export function FormAgentPanel({
  agentId,
  appId,
  currentValues,
  fields,
  formName,
  formUuid,
  onApplyValues,
  prompt,
}: {
  agentId: string;
  appId: string;
  currentValues: Record<string, unknown>;
  fields: SchemaField[];
  formName: string;
  formUuid: string;
  onApplyValues: (values: Record<string, unknown>) => void;
  prompt: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<FormAgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const sequence = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [error, messages, streaming]);
  useEffect(() => {
    setSessionId(null);
    setMessages([]);
  }, [agentId]);
  const context = {
    appId,
    formUuid,
    formDraftAssist: true,
    route: `/${appId}/${formUuid}`,
  };
  async function createSession() {
    const session = await createAgentSessionData(context, agentId, "form_fill");
    setSessionId(session.id);
    return session.id;
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
    setMessages((current) => [
      ...current,
      { id: `form-agent-user-${messageId}`, role: "user", content: normalized },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    try {
      const createdNow = sessionId === null;
      const activeSessionId = sessionId ?? (await createSession());
      if (createdNow)
        void updateAgentSessionData(activeSessionId, {
          title: normalized.slice(0, 36),
        });
      const writableFields = fields.filter((field) => {
        const capability = getFormComponentAgentCapability(field.type);
        return (
          capability.writable &&
          !field.props?.isHidden &&
          !field.props?.isDisabled &&
          !field.props?.isReadOnly &&
          field.props?.defaultValueType !== "formula"
        );
      });
      const nonEmptyValues = Object.fromEntries(
        Object.entries(currentValues).filter(([, value]) => {
          if (value === null || value === undefined || value === "")
            return false;
          if (Array.isArray(value)) return value.length > 0;
          if (typeof value === "object")
            return Object.values(value as Record<string, unknown>).some(
              Boolean,
            );
          return true;
        }),
      );
      const businessContext = [
        `当前业务表单：${formName}`,
        `应用 ID：${appId}`,
        `表单 ID：${formUuid}`,
        Object.keys(nonEmptyValues).length
          ? `当前已有值（仅非空）：${JSON.stringify(nonEmptyValues)}`
          : "当前表单为空",
        "请先调用 yaya_get_form_schema 读取当前表单的最新 Schema，不要依赖历史预分析结果。若用户要求回填，请调用 yaya_propose_form_values 返回候选值，不要提交表单。字段 key 必须使用工具返回的真实字段 id，不得使用字段名称。前端会自动校验并应用工具返回的候选值。",
        `用户请求：${normalized}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const response = await openAgentMessageStream(
        activeSessionId,
        businessContext,
        context,
        agentId,
      );
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        frames.forEach((frame) => {
          const parsed = parseAgentSseFrame(frame);
          if (
            parsed?.type === "run.completed" ||
            (parsed?.type === "dsh.session.event" &&
              parsed.event.type === "turn/end")
          )
            setStreaming(false);
          assistantContent += applyFormAgentFrame(
            frame,
            assistantId,
            setMessages,
          );
        });
        if (done) {
          if (buffer.trim())
            assistantContent += applyFormAgentFrame(
              buffer,
              assistantId,
              setMessages,
            );
          break;
        }
      }
      const valuePatch = extractFormProposal(assistantContent, writableFields);
      if (Object.keys(valuePatch).length > 0) {
        onApplyValues(valuePatch);
        toast.success("Agent 已填写表单", {
          description: `已更新 ${Object.keys(valuePatch).length} 个字段，尚未提交。`,
        });
      }
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Agent 请求失败";
      setError(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId && !item.content
            ? { ...item, content: `Agent 运行失败：${message}` }
            : item,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }
  return (
    <aside className="flex rounded-2xl h-full min-h-0 w-[420px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-control-soft)]">
      {" "}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        {" "}
        <div className="flex min-w-0 items-center gap-3">
          {" "}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
            <FaceRobot className="h-4 w-4" />
          </span>{" "}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">表单 Agent</div>
            <div className="truncate text-xs text-[var(--color-text-secondary)]">
              协助处理 {formName}
            </div>
          </div>{" "}
        </div>{" "}
      </div>{" "}
      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {" "}
        {messages.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            {" "}
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
              <FaceRobot className="h-5 w-5" />
            </span>{" "}
            <p className="mt-3 text-sm font-medium">
              让 Agent 协助处理表单业务
            </p>{" "}
            <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--color-text-secondary)]">
              直接描述业务需求，例如“帮我填写这份申请表，但先不要提交”。
            </p>{" "}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              {" "}
              <div
                className={
                  message.role === "user"
                    ? "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--color-primary-soft)] px-3 py-2 text-sm leading-6"
                    : "w-full px-1 py-1 text-sm leading-7"
                }
              >
                {" "}
                <AgentMessage
                  message={message}
                  loading={streaming && message.role === "assistant"}
                />{" "}
              </div>{" "}
            </div>
          ))
        )}{" "}
        {error ? (
          <p className="rounded-lg bg-[var(--color-danger-soft)] p-3 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}{" "}
      </div>{" "}
      <div className="border-t border-[var(--color-border)] p-3">
        {" "}
        {pendingFiles.length ? (
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            {pendingFiles.map((file, index) => (
              <span
                className="rounded bg-default-100 px-2 py-1"
                key={`${file.name}-${index}`}
              >
                {file.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          {" "}
          <AgentMessageComposer
            value={input}
            loading={streaming}
            error={error}
            onChange={setInput}
            onSend={() => void sendMessage()}
            onFileSelect={(file) => {
              if (file.size > 50 * 1024 * 1024) {
                setError("文件不能超过 50MB");
                return;
              }
              setPendingFiles((items) => [...items, file]);
            }}
          />{" "}
        </div>{" "}
      </div>{" "}
    </aside>
  );
}
function applyFormAgentFrame(
  frame: string,
  assistantId: string,
  setMessages: Dispatch<SetStateAction<FormAgentMessage[]>>,
) {
  const event = parseAgentSseFrame(frame);
  if (event?.type === "dsh.session.event") {
    // Keep the SSE event branch explicit for the dev parser.
    const data = event.event.data ?? {};
    const chunk = data.chunk as { type?: string; text?: string } | undefined;
    if (chunk?.type === "reasoning-delta" && typeof chunk.text === "string") {
      setMessages((current) =>
        current.map((message) =>
          message.id !== assistantId
            ? message
            : {
                ...message,
                reasoning: (message.reasoning ?? "") + chunk.text!,
                timeline: appendTimeline(
                  message.timeline,
                  "reasoning",
                  chunk.text!,
                  assistantId ?? "form-agent",
                ),
              },
        ),
      );
      return "";
    }
    if (chunk?.type === "text-delta" && typeof chunk.text === "string") {
      setMessages((current) =>
        current.map((message) =>
          message.id !== assistantId
            ? message
            : {
                ...message,
                content: message.content + chunk.text!,
                timeline: appendTimeline(
                  message.timeline,
                  "answer",
                  chunk.text!,
                  assistantId ?? "form-agent",
                ),
              },
        ),
      );
      return chunk.text;
    }
    if (event.event.type === "tool/call") {
      const activity = {
        id: String(data.callId ?? `${assistantId}-tool-${Date.now()}`),
        name: String(data.name ?? "tool"),
        status: "running" as const,
        arguments: data.arguments,
      };
      setMessages((current) =>
        current.map((message) =>
          message.id !== assistantId
            ? message
            : {
                ...message,
                toolActivities: [...(message.toolActivities ?? []), activity],
                timeline: [
                  ...(message.timeline ?? []),
                  {
                    id: `${assistantId}-tool-${activity.id}`,
                    type: "tool",
                    activity,
                  } as AgentTimelineItem,
                ],
              },
        ),
      );
    }
    if (event.event.type === "tool/result") {
      const callId =
        (data.message as Record<string, unknown> | undefined)?.source &&
        typeof (
          (data.message as Record<string, unknown>).source as Record<
            string,
            unknown
          >
        ).callId === "string"
          ? String(
              (
                (data.message as Record<string, unknown>).source as Record<
                  string,
                  unknown
                >
              ).callId,
            )
          : undefined;
      if (callId)
        setMessages((current) =>
          current.map((message) =>
            message.id !== assistantId
              ? message
              : {
                  ...message,
                  toolActivities: (message.toolActivities ?? []).map((tool) =>
                    tool.id === callId
                      ? {
                          ...tool,
                          status: "completed" as const,
                          result: data.message,
                        }
                      : tool,
                  ),
                },
          ),
        );
      const resultText = JSON.stringify(
        (data.message as Record<string, unknown> | undefined)?.content ??
          data.message,
      );
      try {
        const proposal = JSON.parse(resultText) as {
          type?: string;
          values?: unknown;
        };
        if (
          proposal.type === "form_values_proposal" &&
          proposal.values &&
          typeof proposal.values === "object"
        )
          return `form_values_proposal:${JSON.stringify(proposal.values)}`;
      } catch {
        /* tool result is not JSON */
      }
    }
    return "";
  }
  if (event?.type === "message.delta") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? { ...message, content: message.content + event.delta }
          : message,
      ),
    );
    return event.delta;
  }
  if (event?.type === "run.failed" || event?.type === "message.failed")
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? { ...message, content: `Agent 运行失败：${event.message}` }
          : message,
      ),
    );
  return "";
}

function appendTimeline(
  timeline: AgentTimelineItem[] | undefined,
  type: "reasoning" | "answer",
  text: string,
  owner: string,
): AgentTimelineItem[] {
  const items = [...(timeline ?? [])];
  const last = items[items.length - 1];
  if (last?.type === type)
    items[items.length - 1] = { ...last, text: (last.text ?? "") + text };
  else items.push({ id: `${owner}-${type}-${Date.now()}`, type, text });
  return items;
}
function extractFormProposal(content: string, writableFields: SchemaField[]) {
  const marker = content.match(
    /form_values_proposal[\\s\\S]*?values["']?\\s*[:=]\\s*(\\{[\\s\\S]*?\\})/i,
  );
  if (!marker) return {};
  try {
    const parsed = JSON.parse(marker[1]) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([id]) =>
        writableFields.some((field) => field.id === id),
      ),
    );
  } catch {
    return {};
  }
}
function normalizeAgentFieldValue(
  field: SchemaField,
  value: unknown,
): { accepted: boolean; value: unknown } {
  const capability = getFormComponentAgentCapability(field.type);
  if (!capability.writable) return { accepted: false, value: undefined };
  const optionValues = new Set(
    (field.props?.options ?? []).map((option) => option.value),
  );
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
    if (!Number.isFinite(numberValue))
      return { accepted: false, value: undefined };
    if (
      typeof field.props?.minValue === "number" &&
      numberValue < field.props.minValue
    )
      return { accepted: false, value: undefined };
    if (
      typeof field.props?.maxValue === "number" &&
      numberValue > field.props.maxValue
    )
      return { accepted: false, value: undefined };
    return { accepted: true, value: numberValue };
  }
  if (capability.valueType === "string[]") {
    if (!Array.isArray(value)) return { accepted: false, value: undefined };
    const values = value.filter(
      (item): item is string => typeof item === "string",
    );
    if (values.length !== value.length)
      return { accepted: false, value: undefined };
    if (optionValues.size > 0 && values.some((item) => !optionValues.has(item)))
      return { accepted: false, value: undefined };
    return { accepted: true, value: values };
  }
  if (capability.valueType === "dateRange") {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some(
        (item) => typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item),
      )
    )
      return { accepted: false, value: undefined };
    return { accepted: true, value };
  }
  if (capability.valueType === "date") {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? { accepted: true, value }
      : { accepted: false, value: undefined };
  }
  if (capability.valueType === "string") {
    if (typeof value !== "string") return { accepted: false, value: undefined };
    if (optionValues.size > 0 && !optionValues.has(value))
      return { accepted: false, value: undefined };
    return { accepted: true, value };
  }
  if (capability.valueType === "boolean" && typeof value === "boolean")
    return { accepted: true, value };
  return { accepted: false, value: undefined };
}
