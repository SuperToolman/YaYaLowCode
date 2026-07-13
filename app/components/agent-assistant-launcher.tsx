"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { FaceRobot, Gear, PaperPlane, Plus, Sparkles } from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { Card } from "@heroui/react/card";

type AgentMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt?: string;
};

type AgentSession = {
  id: string;
  title: string;
  appId?: string;
  status: string;
  updatedAt: string;
};

type AgentPageContext = {
  appId?: string;
  formUuid?: string;
  automationId?: string;
  route: string;
};

type ApiEnvelope<T> = {
  code: number;
  message: string;
  data: T | null;
};

const suggestions = [
  "帮我分析当前应用结构",
  "当前表单有哪些字段？",
  "检查自动化流程是否合理",
];

export default function AgentAssistantLauncher() {
  const router = useRouter();
  const pathname = usePathname();
  const pageContext = useMemo(() => buildPageContext(pathname), [pathname]);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState("准备就绪");
  const [errorMessage, setErrorMessage] = useState("");
  const localMessageSequence = useRef(0);

  const loadMessages = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as ApiEnvelope<AgentMessage[]>;
    if (!response.ok || payload.code !== 0 || !payload.data) {
      throw new Error(payload.message || "无法加载 Agent 消息");
    }
    setMessages(payload.data);
  }, []);

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/agent/sessions", { cache: "no-store" });
      const payload = (await response.json()) as ApiEnvelope<AgentSession[]>;
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "无法加载 Agent 会话");
      }
      setSessions(payload.data);
      const sessionId = preferredSessionId ?? activeSessionId ?? payload.data[0]?.id ?? null;
      setActiveSessionId(sessionId);
      if (sessionId) await loadMessages(sessionId);
      else setMessages([]);
      setStatusText("准备就绪");
    } catch (reason) {
      setStatusText("Agent 服务不可用");
      setErrorMessage(reason instanceof Error ? reason.message : "无法加载 Agent 会话");
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId, loadMessages]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => void loadSessions(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadSessions]);

  async function createSession() {
    const response = await fetch("/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: pageContext }),
    });
    const payload = (await response.json()) as ApiEnvelope<AgentSession>;
    if (!response.ok || payload.code !== 0 || !payload.data) {
      throw new Error(payload.message || "无法创建 Agent 会话");
    }
    setSessions((current) => [payload.data!, ...current]);
    setActiveSessionId(payload.data.id);
    setMessages([]);
    return payload.data.id;
  }

  async function startNewSession() {
    if (isStreaming) return;
    setErrorMessage("");
    try {
      await createSession();
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : "无法创建 Agent 会话");
    }
  }

  async function selectSession(sessionId: string) {
    if (sessionId === activeSessionId || isStreaming) return;
    setActiveSessionId(sessionId);
    setIsLoading(true);
    setErrorMessage("");
    try {
      await loadMessages(sessionId);
      setStatusText("准备就绪");
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : "无法加载 Agent 消息");
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage(content = input) {
    const normalized = content.trim();
    if (!normalized || isStreaming) return;

    setInput("");
    setErrorMessage("");
    setIsStreaming(true);
    setStatusText("正在连接模型");
    localMessageSequence.current += 1;
    const messageSequence = localMessageSequence.current;
    const assistantMessageId = `local-assistant-${messageSequence}`;

    try {
      const sessionId = activeSessionId ?? await createSession();
      setMessages((current) => [
        ...current,
        { id: `local-user-${messageSequence}`, role: "user", content: normalized },
        { id: assistantMessageId, role: "assistant", content: "" },
      ]);
      const response = await fetch(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ content: normalized, context: pageContext }),
        },
      );
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as ApiEnvelope<never>;
        throw new Error(payload.message || "Agent 请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        frames.forEach((frame) =>
          handleSseFrame(frame, assistantMessageId, setMessages, setStatusText, setErrorMessage),
        );
        if (done) {
          if (buffer.trim()) {
            handleSseFrame(buffer, assistantMessageId, setMessages, setStatusText, setErrorMessage);
          }
          break;
        }
      }
      await loadSessions(sessionId);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Agent 请求失败";
      setErrorMessage(message);
      setStatusText("运行失败");
      setMessages((current) => current.map((item) =>
        item.id === assistantMessageId && !item.content
          ? { ...item, content: `Agent 运行失败：${message}` }
          : item,
      ));
    } finally {
      setIsStreaming(false);
    }
  }

  const hasMessages = messages.length > 0;
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  return (
    <>
      <button
        type="button"
        aria-label="打开 YaYa Agent"
        className="group flex min-h-[72px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-transparent bg-transparent px-2 py-3 text-center text-[var(--color-text-secondary)] transition-all duration-200 backdrop-blur-xl hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-text-primary)]"
        onClick={() => setIsOpen(true)}
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-control-selected)]">
          <FaceRobot className="h-5 w-5" />
          <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-bg-canvas)] ${errorMessage ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`} />
        </span>
        <span className="text-xs font-medium leading-4">Agent</span>
      </button>

      <Modal isOpen={isOpen} onOpenChange={setIsOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" scroll="inside" size="cover">
            <Modal.Dialog className="flex h-[min(720px,88vh)] w-[min(1040px,94vw)] flex-col overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <Modal.Header className="flex items-center justify-between">
                <Card className="flex w-full min-w-0 items-center gap-3 border-[var(--color-border)] bg-[var(--color-control-soft)]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <Modal.Heading className="truncate text-lg font-semibold text-[var(--color-text-primary)]">YaYa Agent</Modal.Heading>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <span className={`h-2 w-2 rounded-full ${isStreaming ? "animate-pulse bg-[var(--color-primary)]" : errorMessage ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`} />
                      {statusText}
                    </div>
                  </div>
                </Card>
                <Modal.CloseTrigger aria-label="关闭 Agent" />
              </Modal.Header>

              <Modal.Body className="min-h-0 flex-1 overflow-hidden p-0">
                <div className="flex h-full min-h-0">
                  <Card className="hidden w-[230px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-control-soft)] p-3 sm:flex">
                    <Button className="h-10 w-full justify-start rounded-xl bg-[var(--color-primary)] px-3 text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)]" isDisabled={isStreaming} onClick={() => void startNewSession()}>
                      <Plus className="h-4 w-4" />新对话
                    </Button>
                    <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-disabled)]">最近对话</div>
                    <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
                      {sessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className={`w-full truncate rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${session.id === activeSessionId ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "border-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"}`}
                          onClick={() => void selectSession(session.id)}
                        >
                          {session.title}
                        </button>
                      ))}
                      {!isLoading && sessions.length === 0 ? <p className="px-2 py-3 text-xs text-[var(--color-text-secondary)]">暂无历史会话</p> : null}
                    </div>
                    <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-primary)]"><Sparkles className="h-4 w-4 text-[var(--color-primary)]" />只读 Agent MVP</div>
                      <p className="mt-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">可以读取表单 Schema 和自动化流程，暂不执行修改。</p>
                      <Button variant="ghost" className="mt-3 h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] text-xs text-[var(--color-text-primary)]" onClick={() => { setIsOpen(false); router.push("/settings/agent"); }}>
                        <Gear className="h-4 w-4" />Agent 配置
                      </Button>
                    </div>
                  </Card>

                  <section className="flex min-w-0 flex-1 flex-col bg-[var(--color-bg-canvas)]">
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                      {errorMessage ? <div className="mx-auto mb-4 max-w-2xl rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{errorMessage}</div> : null}
                      {!hasMessages ? (
                        <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
                          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] shadow-[var(--shadow-sm)]"><Sparkles className="h-7 w-7" /></span>
                          <h2 className="mt-5 text-2xl font-semibold text-[var(--color-text-primary)]">今天想了解什么？</h2>
                          <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--color-text-secondary)]">Agent 可以读取当前应用的表单和自动化配置，并通过 SSE 实时返回分析结果。</p>
                          <div className="mt-6 grid w-full gap-2 sm:grid-cols-3">
                            {suggestions.map((suggestion) => <button key={suggestion} type="button" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-3 text-left text-xs leading-5 text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]" onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}
                          </div>
                        </div>
                      ) : (
                        <div className="mx-auto max-w-2xl space-y-4">
                          {activeSession ? <div className="text-center text-[10px] text-[var(--color-text-disabled)]">{activeSession.title}</div> : null}
                          {messages.map((message) => (
                            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                              <div className={`max-w-[86%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-[var(--color-primary)] text-[var(--color-text-on-primary)]" : "border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"}`}>
                                {message.content || <span className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-primary)]" />正在思考…</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-4 sm:px-6">
                      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-input)] p-2 shadow-[var(--shadow-sm)] focus-within:border-[var(--color-primary)] focus-within:ring-4 focus-within:ring-[var(--color-primary-soft)]">
                        <textarea aria-label="给 Agent 发送消息" className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]" placeholder="询问当前应用、表单或自动化…" rows={1} value={input} disabled={isStreaming} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
                        <Button isIconOnly aria-label="发送消息" className="h-10 min-h-10 w-10 min-w-10 rounded-xl bg-[var(--color-primary)] p-0 text-[var(--color-text-on-primary)] disabled:opacity-40" isDisabled={!input.trim() || isStreaming} onClick={() => void sendMessage()}><PaperPlane className="h-4 w-4" /></Button>
                      </div>
                      <p className="mx-auto mt-2 max-w-2xl text-center text-[10px] text-[var(--color-text-disabled)]">当前版本仅开放只读工具；会话、运行步骤和工具调用会写入审计日志。</p>
                    </div>
                  </section>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}

function buildPageContext(pathname: string): AgentPageContext {
  const segments = pathname.split("/").filter(Boolean);
  const appId = segments.find((segment) => segment.startsWith("APP_"));
  const formUuid = segments.find((segment) => segment.startsWith("FORM-"));
  const automationIndex = segments.indexOf("automations");
  const automationId = automationIndex >= 0 && segments[automationIndex + 1]?.startsWith("AUTO-")
    ? segments[automationIndex + 1]
    : undefined;
  return { appId, formUuid, automationId, route: pathname };
}

function handleSseFrame(
  frame: string,
  assistantMessageId: string,
  setMessages: Dispatch<SetStateAction<AgentMessage[]>>,
  setStatusText: Dispatch<SetStateAction<string>>,
  setErrorMessage: Dispatch<SetStateAction<string>>,
) {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>; } catch { return; }

  if (eventName === "message.delta" && typeof payload.delta === "string") {
    setMessages((current) => current.map((message) => message.id === assistantMessageId ? { ...message, content: message.content + payload.delta } : message));
  } else if (eventName === "tool.started") {
    setStatusText(`正在读取 ${toolLabel(String(payload.name ?? "工具"))}`);
  } else if (eventName === "tool.completed") {
    setStatusText("已读取数据，正在整理回答");
  } else if (eventName === "status") {
    setStatusText("正在思考");
  } else if (eventName === "run.completed") {
    setStatusText("回答完成");
  } else if (eventName === "run.failed") {
    const message = typeof payload.message === "string" ? payload.message : "Agent 运行失败";
    setErrorMessage(message);
    setStatusText("运行失败");
  }
}

function toolLabel(name: string) {
  return ({ list_forms: "表单列表", get_form_schema: "表单 Schema", list_automations: "自动化列表", get_automation_graph: "自动化流程" } as Record<string, string>)[name] ?? name;
}
