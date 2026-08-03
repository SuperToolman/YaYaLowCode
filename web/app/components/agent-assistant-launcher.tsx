"use client";

import {
  useCallback,
  useEffect,
  Fragment,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { ArrowChevronLeft, ArrowChevronRight, ArrowDown, ChevronDown, Code, Ellipsis, FaceRobot, Gear, PaperPlane, Paperclip, Plus, Sparkles, Xmark } from "@gravity-ui/icons";
import { Button, Dropdown, Tabs } from "@heroui/react";
import { Drawer } from "@heroui/react/drawer";
import { createAgentSession, deleteAgentSession, listAgentMessages, listAgentSessions, updateAgentSession } from "../lib/api-client";
import { AgentMarkdown } from "./agent-markdown";
import { useAuth } from "./auth-provider";
import { requestApi } from "../lib/api-request";

type PendingAction = { id: string; actionType: string; summary: string; status: "pending"; createdAt: string; expiresAt: string };

type AgentMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt?: string;
  metadata?: unknown;
  runId?: string;
  toolActivities?: AgentToolActivity[];
  attachments?: AttachedImage[];
  pendingActions?: PendingAction[];
};

type AttachedImage = { id: string; name: string; previewUrl: string };

type AgentToolActivity = { id: string; name: string; status: "running" | "completed" };

type AgentSession = {
  id: string;
  agentId: string;
  title: string;
  appId?: string;
  status: string;
  source: SessionSource;
  isPinned: boolean;
  modelProvider?: string | null;
  updatedAt: string;
};

type SessionSource = "general" | "schema_analysis" | "form_fill";
type SessionFilter = "all" | SessionSource;

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

type AgentRunTrace = { runId: string; status: string; steps: Array<{ index: number; tool: string; arguments: unknown; summary: unknown; status: string }> };

const suggestions = [
  "帮我分析当前应用结构",
  "当前表单有哪些字段？",
  "检查自动化流程是否合理",
  "帮我梳理当前数据关系",
  "这个页面有哪些可优化点？",
  "根据当前配置给出下一步建议",
];

export default function AgentAssistantLauncher() {
  const router = useRouter();
  const pathname = usePathname();
  const { hasPermission, user } = useAuth();
  const canConfigureAgents = hasPermission("settings.agent");
  const pageContext = useMemo(() => buildPageContext(pathname), [pathname]);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [pendingImages, setPendingImages] = useState<AttachedImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState("准备就绪");
  const [errorMessage, setErrorMessage] = useState("");
  const [isNearMessagesBottom, setIsNearMessagesBottom] = useState(true);
  const localMessageSequence = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const scrollMessagesToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    shouldAutoScrollRef.current = true;
    setIsNearMessagesBottom(true);
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    shouldAutoScrollRef.current = true;
    const frame = window.requestAnimationFrame(scrollMessagesToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, scrollMessagesToBottom]);

  useEffect(() => {
    if (!isOpen || !shouldAutoScrollRef.current) return;
    const frame = window.requestAnimationFrame(scrollMessagesToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [errorMessage, isOpen, messages, scrollMessagesToBottom]);

  const loadMessages = useCallback(async (sessionId: string) => {
    const { data, error } = await listAgentMessages({ path: { sessionId }, responseStyle: "fields" });
    const payload = data as ApiEnvelope<AgentMessage[]> | undefined;
    if (error || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || "无法加载 Agent 消息");
    const messages = payload.data;
    shouldAutoScrollRef.current = true;
    setIsNearMessagesBottom(true);
    const pendingActions = await requestApi<PendingAction[]>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions`, { cache: "no-store" }).catch(() => []);
    const restored = pendingActions.length ? [{ id: `pending-actions-${sessionId}`, role: "assistant" as const, content: "", createdAt: pendingActions[0].createdAt, pendingActions }] : [];
    setMessages([...messages, ...restored]);
  }, []);

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await listAgentSessions({ responseStyle: "fields" });
      const payload = data as ApiEnvelope<AgentSession[]> | undefined;
      if (error || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || "无法加载 Agent 会话");
      const loadedSessions = payload.data;
      const sortedSessions = [...loadedSessions].sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      setSessions(sortedSessions);
      const sessionId = preferredSessionId ?? sortedSessions[0]?.id ?? null;
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
  }, [loadMessages]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        await loadSessions();
      })().catch((reason) => setErrorMessage(reason instanceof Error ? reason.message : "无法加载 Agent"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadSessions]);

  async function createSession() {
    const { data, error } = await createAgentSession({ body: { source: "general", context: pageContext }, responseStyle: "fields" });
    const payload = data as ApiEnvelope<AgentSession> | undefined;
    if (error || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || "无法创建 Agent 会话");
    const session = payload.data;
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setMessages([]);
    return session.id;
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

    const attachments = pendingImages;
    setInput("");
    setPendingImages([]);
    setErrorMessage("");
    setIsStreaming(true);
    setStatusText("正在连接模型");
    localMessageSequence.current += 1;
    const messageSequence = localMessageSequence.current;
    const assistantMessageId = `local-assistant-${messageSequence}`;
    const createdAt = new Date().toISOString();

    try {
      const sessionId = activeSessionId ?? await createSession();
      shouldAutoScrollRef.current = true;
      setIsNearMessagesBottom(true);
      setMessages((current) => [
        ...current,
        { id: `local-user-${messageSequence}`, role: "user", content: normalized, attachments, createdAt },
        { id: assistantMessageId, role: "assistant", content: "", createdAt, toolActivities: [] },
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
          handleSseFrame(frame, assistantMessageId, sessionId, setMessages, setStatusText, setErrorMessage),
        );
        if (done) {
          if (buffer.trim()) {
            handleSseFrame(buffer, assistantMessageId, sessionId, setMessages, setStatusText, setErrorMessage);
          }
          break;
        }
      }
      await loadMessages(sessionId);
      setSessions((current) => {
        const completedSession = current.find((session) => session.id === sessionId);
        if (!completedSession) return current;
        const updatedSession = {
          ...completedSession,
          title: completedSession.title === "新对话" ? conversationTitle(normalized) : completedSession.title,
          updatedAt: new Date().toISOString(),
        };
        return [updatedSession, ...current.filter((session) => session.id !== sessionId)];
      });
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

  async function updateSession(sessionId: string, update: { title?: string; isPinned?: boolean }) {
    const { data, error } = await updateAgentSession({ path: { sessionId }, body: update, responseStyle: "fields" });
    const payload = data as ApiEnvelope<AgentSession> | undefined;
    if (error || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || "无法更新会话");
    const updatedSession = payload.data;
    setSessions((current) => current.map((session) => session.id === sessionId ? updatedSession : session)
      .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)));
  }

  async function deleteSession(sessionId: string) {
    const { data, error } = await deleteAgentSession({ path: { sessionId }, responseStyle: "fields" });
    const payload = data as ApiEnvelope<unknown> | undefined;
    if (error || payload?.code !== 0) throw new Error(payload?.message || "无法删除会话");
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }

  async function handleSessionAction(session: AgentSession, action: "pin" | "rename" | "delete") {
    if (isStreaming) return;
    try {
      if (action === "pin") await updateSession(session.id, { isPinned: !session.isPinned });
      if (action === "rename") {
        const title = window.prompt("重命名聊天记录", session.title)?.trim();
        if (title) await updateSession(session.id, { title });
      }
      if (action === "delete" && window.confirm(`删除“${session.title}”？`)) await deleteSession(session.id);
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : "会话操作失败");
    }
  }

  function addImages(files: FileList | null) {
    if (!files) return;
    const images = [...files]
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, name: file.name, previewUrl: URL.createObjectURL(file) }));
    setPendingImages((current) => [...current, ...images].slice(0, 6));
  }

  function removePendingImage(id: string) {
    setPendingImages((current) => {
      const image = current.find((item) => item.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  const hasMessages = messages.length > 0;
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const visibleSessions = useMemo(
    () => sessionFilter === "all" ? sessions : sessions.filter((session) => session.source === sessionFilter),
    [sessionFilter, sessions],
  );

  return (
    <>
      <button
        type="button"
        aria-label="打开 YaYa Agent"
        className="group flex h-[68px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent bg-transparent px-2 text-center text-[var(--color-text-secondary)] transition-all duration-200 backdrop-blur-xl hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-text-primary)]"
        onClick={() => setIsOpen(true)}
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-control-selected)]">
          <FaceRobot className="h-5 w-5" />
          <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-bg-canvas)] ${errorMessage ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`} />
        </span>
        <span className="text-[11px] font-medium leading-4">Agent</span>
      </button>

      <Drawer isOpen={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
          <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-[100dvh] w-[80vw] max-w-[80vw] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <Drawer.Header className="!flex !flex-row !items-center !justify-between min-h-14 gap-3 border-b border-[var(--color-border)] px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <Button isIconOnly variant="ghost" aria-label={isHistoryCollapsed ? "展开聊天记录列表" : "收起聊天记录列表"} className="hidden h-8 w-8 shrink-0 text-[var(--color-text-secondary)] sm:inline-flex" onPress={() => setIsHistoryCollapsed((current) => !current)}>
                    {isHistoryCollapsed ? <ArrowChevronRight className="h-4 w-4" /> : <ArrowChevronLeft className="h-4 w-4" />}
                  </Button>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-4 w-4" /></span>
                  <div className="min-w-0">
                  <Drawer.Heading className="truncate text-sm font-semibold text-[var(--color-text-primary)]">YaYa Agent</Drawer.Heading>
                    <p className="truncate text-[11px] text-[var(--color-text-secondary)]">{activeSession?.title || "开始新的对话"}</p>
                  </div>
                </div>
                <div className="ml-auto hidden shrink-0 items-center gap-2 whitespace-nowrap sm:flex">
                  <div className="flex items-center gap-1.5 rounded-md bg-[var(--color-control-soft)] px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)]">
                    <span className={`h-2 w-2 rounded-full ${isStreaming ? "animate-pulse bg-[var(--color-primary)]" : errorMessage ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`} />
                    {statusText}
                  </div>
                  {activeSession?.modelProvider ? <span className="max-w-44 truncate rounded-md border border-[var(--color-border)] px-2 py-1.5 text-[11px] text-[var(--color-text-secondary)]" title={activeSession.modelProvider}>{activeSession.modelProvider}</span> : null}
                  {canConfigureAgents ? <Button variant="ghost" className="h-9 rounded-lg px-3 text-sm text-[var(--color-text-secondary)]" onClick={() => { setIsOpen(false); router.push("/settings/agents"); }}>
                    <Gear className="h-4 w-4" />配置
                  </Button> : null}
                  <Tabs variant="secondary" selectedKey={sessionFilter} onSelectionChange={(key) => setSessionFilter(key as SessionFilter)} className="mr-1 hidden w-auto shrink-0 !gap-0 lg:flex">
                    <Tabs.ListContainer className="w-auto">
                      <Tabs.List aria-label="聊天记录场景" className="!w-auto !flex-nowrap whitespace-nowrap">
                        <Tabs.Tab id="all" className="!w-auto shrink-0 whitespace-nowrap px-2 py-1.5 text-xs">全部<Tabs.Indicator /></Tabs.Tab>
                        <Tabs.Tab id="general" className="!w-auto shrink-0 whitespace-nowrap px-2 py-1.5 text-xs">普通对话<Tabs.Indicator /></Tabs.Tab>
                        <Tabs.Tab id="schema_analysis" className="!w-auto shrink-0 whitespace-nowrap px-2 py-1.5 text-xs">Schema分析<Tabs.Indicator /></Tabs.Tab>
                        <Tabs.Tab id="form_fill" className="!w-auto shrink-0 whitespace-nowrap px-2 py-1.5 text-xs">Agent填写<Tabs.Indicator /></Tabs.Tab>
                      </Tabs.List>
                    </Tabs.ListContainer>
                  </Tabs>
                </div>
                <Drawer.CloseTrigger aria-label="关闭 Agent" className="!static !ml-2 shrink-0" />
              </Drawer.Header>

              <Drawer.Body className="min-h-0 flex-1 overflow-hidden p-0">
                <div className="flex h-full min-h-0">
                  <aside className={`${isHistoryCollapsed ? "hidden" : "hidden sm:flex"} w-[216px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-control-soft)]`}>
                    <div className="p-3">
                      <Button className="h-10 w-full justify-start rounded-xl bg-[var(--color-primary)] px-3 text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)]" isDisabled={isStreaming} onClick={() => void startNewSession()}>
                        <Plus className="h-4 w-4" />新对话
                      </Button>
                    </div>
                    <VirtualSessionList sessions={visibleSessions} activeSessionId={activeSessionId} isLoading={isLoading} onSelect={selectSession} onAction={handleSessionAction} />
                  </aside>

                  <section className="flex min-w-0 flex-1 flex-col bg-[var(--color-bg-canvas)]">
                    <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 sm:hidden">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                          <span className={`h-2 w-2 rounded-full ${isStreaming ? "animate-pulse bg-[var(--color-primary)]" : errorMessage ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`} />
                          {statusText}
                        </div>
                        <Button variant="ghost" className="h-8 rounded-xl px-2.5 text-xs" isDisabled={isStreaming} onClick={() => void startNewSession()}><Plus className="h-4 w-4" />新对话</Button>
                      </div>
                    </div>
                    <div
                      ref={messagesContainerRef}
                      className="min-h-0 flex-1 overflow-y-auto p-0"
                      onScroll={(event) => {
                        const container = event.currentTarget;
                        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
                        shouldAutoScrollRef.current = isNearBottom;
                        setIsNearMessagesBottom(isNearBottom);
                      }}
                    >
                      {errorMessage ? <div className="mx-auto mb-5 max-w-[800px] rounded-2xl border border-[var(--color-danger)]/20 bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{errorMessage}</div> : null}
                      {!hasMessages ? (
                        <div className="mx-auto flex min-h-full max-w-[800px] flex-col justify-center py-10">
                          <div className="flex items-center gap-3 text-sm font-medium text-[var(--color-primary)]"><Sparkles className="h-5 w-5" />基于当前页面上下文</div>
                          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--color-text-primary)]">分析应用、表单和自动化流程</h2>
                          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">直接描述你想了解的问题，Agent 会读取当前页面相关配置并给出分析结果。</p>
                          <div className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {suggestions.map((suggestion) => <button key={suggestion} type="button" className="group flex min-h-14 items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3.5 py-2.5 text-left text-sm leading-5 text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary)]" onClick={() => void sendMessage(suggestion)}><span>{suggestion}</span><span className="text-[var(--color-text-disabled)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-primary)]">→</span></button>)}
                          </div>
                        </div>
                      ) : (
                        <div className="mx-auto w-full max-w-[888px] space-y-6 py-6">
                            {messages.map((message) => (
                            <MessageRow key={message.id} message={message} sessionId={activeSessionId} userName={user?.displayName ?? user?.username ?? "我"} onPendingAction={async (action, operation) => {
                              const endpoint = `/api/agent/sessions/${encodeURIComponent(activeSessionId ?? "")}/pending-actions/${encodeURIComponent(action.id)}/${operation}`;
                              await requestApi<unknown>(endpoint, { method: "POST" });
                              if (activeSessionId) await loadMessages(activeSessionId);
                            }} />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="relative bg-[var(--color-bg-canvas)] p-0">
                      {hasMessages && !isNearMessagesBottom ? <Button isIconOnly aria-label="回到最新消息" className="absolute bottom-full right-4 mb-3 h-9 w-9 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]" onClick={scrollMessagesToBottom}><ArrowDown className="h-4 w-4" /></Button> : null}
                      <div className="mx-auto max-w-[800px] rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2 shadow-[var(--shadow-sm)] focus-within:border-[var(--color-primary)] focus-within:ring-4 focus-within:ring-[var(--color-primary-soft)]">
                        {pendingImages.length ? <div className="flex flex-wrap gap-2 px-1 pb-2">{pendingImages.map((image) => <div key={image.id} className="group relative h-14 w-14 overflow-hidden rounded-md border border-[var(--color-border)]"><Image src={image.previewUrl} alt={image.name} width={56} height={56} unoptimized className="h-full w-full object-cover" /><button type="button" aria-label={`移除 ${image.name}`} className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex" onClick={() => removePendingImage(image.id)}><Xmark className="h-3 w-3" /></button></div>)}</div> : null}
                        <div className="flex items-end gap-2">
                          <input ref={imageInputRef} aria-label="上传图片" className="hidden" type="file" accept="image/*" multiple onChange={(event) => { addImages(event.currentTarget.files); event.currentTarget.value = ""; }} />
                          <Button isIconOnly variant="ghost" aria-label="上传图片" className="h-10 min-h-10 w-10 min-w-10 rounded-xl text-[var(--color-text-secondary)]" isDisabled={isStreaming} onPress={() => imageInputRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
                          <textarea aria-label="给 Agent 发送消息" className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]" placeholder="询问当前应用、表单或自动化…" rows={1} value={input} disabled={isStreaming} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
                          <Button isIconOnly aria-label="发送消息" className="h-10 min-h-10 w-10 min-w-10 rounded-xl bg-[var(--color-primary)] p-0 text-[var(--color-text-on-primary)] disabled:opacity-40" isDisabled={!input.trim() || isStreaming} onClick={() => void sendMessage()}><PaperPlane className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </>
  );
}

function MessageRow({ message, sessionId, userName, onPendingAction }: { message: AgentMessage; sessionId: string | null; userName: string; onPendingAction: (action: PendingAction, operation: "confirm" | "cancel") => Promise<void> }) {
  const isUser = message.role === "user";
  const pendingOutcome = parsePendingActionOutcome(message.metadata);
  return (
    <div className="relative w-full px-[44px]">
      <div className={`absolute top-0 flex h-8 w-8 items-center justify-center rounded-full ${isUser ? "right-0 bg-[var(--color-control-selected)] text-[var(--color-primary)]" : "left-0 bg-[var(--color-primary-soft)] text-[var(--color-primary)]"}`}>
        {isUser ? <span className="text-xs font-semibold">{avatarLabel(userName)}</span> : <FaceRobot className="h-4 w-4" />}
      </div>
      <div className={`w-full min-w-0 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`mb-1 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)] ${isUser ? "flex-row-reverse" : ""}`}>
          <span>{isUser ? userName : "YaYa Agent"}</span>
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        </div>
        <div className={`text-sm leading-7 ${isUser ? "max-w-[82%] rounded-2xl rounded-br-md bg-[var(--color-control-selected)] px-4 py-2.5 text-[var(--color-text-primary)]" : "w-full text-[var(--color-text-primary)]"}`}>
          {message.attachments?.length ? <div className="mb-2 flex flex-wrap gap-2">{message.attachments.map((image) => <Image key={image.id} src={image.previewUrl} alt={image.name} width={224} height={192} unoptimized className="max-h-48 max-w-56 rounded-md border border-[var(--color-border)] object-cover" />)}</div> : null}
          {message.content ? (
            <MessageContent content={message.content} compact={isUser} />
          ) : pendingOutcome ? null : <span className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-primary)]" />正在思考…</span>}
          {pendingOutcome ? <PendingActionOutcomeCard outcome={pendingOutcome} /> : null}
          {message.role === "assistant" && message.toolActivities?.length ? <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">{message.toolActivities.map((tool) => <span key={tool.id} className={tool.status === "completed" ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-success-soft)] px-2 py-1 text-[11px] text-[var(--color-success)]" : "inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary-soft)] px-2 py-1 text-[11px] text-[var(--color-primary)]"}><span className={`h-1.5 w-1.5 rounded-full ${tool.status === "completed" ? "bg-[var(--color-success)]" : "animate-pulse bg-[var(--color-primary)]"}`} />{tool.status === "completed" ? "已查询" : "查询中"} {toolLabel(tool.name)}</span>)}</div> : null}
          {message.role === "assistant" && message.runId && sessionId ? <RunTracePanel sessionId={sessionId} runId={message.runId} /> : null}
          {message.pendingActions?.length ? <PendingActionPanel actions={message.pendingActions} onAction={onPendingAction} /> : null}
        </div>
      </div>
    </div>
  );
}

type PendingActionOutcome = { status: "confirmed" | "completed"; summary: string; actionType: string; result?: Record<string, unknown> };

function parsePendingActionOutcome(metadata: unknown): PendingActionOutcome | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  const status = value.status;
  if ((status !== "confirmed" && status !== "completed") || typeof value.pendingActionId !== "string" || typeof value.summary !== "string" || typeof value.actionType !== "string") return null;
  const result = value.result;
  return { status, summary: value.summary, actionType: value.actionType, result: result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined };
}

function PendingActionOutcomeCard({ outcome }: { outcome: PendingActionOutcome }) {
  const completed = outcome.status === "completed";
  return <div className={`mt-1 w-full border p-3 text-sm ${completed ? "border-[var(--color-success)]/30 bg-[var(--color-success-soft)]" : "border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)]"}`}><p className="font-medium">{completed ? "已完成" : "已确认执行"}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{outcome.summary}</p>{completed && outcome.result ? <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[var(--color-border)]/70 pt-2 text-xs">{Object.entries(outcome.result).map(([key, value]) => <Fragment key={key}><dt className="text-[var(--color-text-secondary)]">{outcomeResultLabel(key)}</dt><dd className="min-w-0 break-all text-[var(--color-text-primary)]">{formatOutcomeValue(value)}</dd></Fragment>)}</dl> : null}</div>;
}

function outcomeResultLabel(key: string) {
  return ({ id: "ID", name: "名称", title: "名称", status: "状态", formUuid: "表单 ID", sourceFormUuid: "父表 ID", subformFieldId: "明细字段", version: "版本", flowType: "类型" } as Record<string, string>)[key] ?? key;
}

function formatOutcomeValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function RunTracePanel({ sessionId, runId }: { sessionId: string; runId: string }) {
  const [trace, setTrace] = useState<AgentRunTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function loadTrace() {
    setLoading(true); setError("");
    try {
      const nextTrace = await requestApi<AgentRunTrace>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/trace`, { cache: "no-store" });
      setTrace(nextTrace);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取分析依据"); }
    finally { setLoading(false); }
  }
  return <div className="mt-3 border-t border-[var(--color-border)] pt-3">
    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-[var(--color-text-secondary)]" isPending={loading} onPress={() => void loadTrace()}>{trace ? "刷新分析依据" : "查看分析依据"}</Button>
    {error ? <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
    {trace ? <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">{trace.steps.length ? trace.steps.map((step) => <div key={step.index} className="text-xs"><p className="font-medium text-[var(--color-text-primary)]">{step.index}. {toolLabel(step.tool)}</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-secondary)]">{JSON.stringify(step.arguments, null, 2)}</pre></div>) : <p className="text-xs text-[var(--color-text-secondary)]">本次回答未调用数据工具。</p>}</div> : null}
  </div>;
}

function PendingActionPanel({ actions, onAction }: { actions: PendingAction[]; onAction: (action: PendingAction, operation: "confirm" | "cancel") => Promise<void> }) {
  const [error, setError] = useState("");
  const perform = (action: PendingAction, operation: "confirm" | "cancel") => void onAction(action, operation).catch((reason) => setError(reason instanceof Error ? reason.message : "操作失败"));
  return <div className="mt-3 border border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] p-3 text-sm"><p className="font-medium">待确认操作（{actions.length} 项）</p><div className="mt-2 divide-y divide-[var(--color-warning)]/20">{actions.map((action) => <div key={action.id} className="py-3 first:pt-0 last:pb-0"><p className="text-xs text-[var(--color-text-secondary)]">{action.summary}</p>{action.actionType === "save_form_schema_draft" ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">将创建一个未发布的新 Schema 草稿版本。</p> : null}<div className="mt-2 flex gap-2"><Button size="sm" onPress={() => perform(action, "confirm")}>确认执行</Button><Button size="sm" variant="ghost" onPress={() => perform(action, "cancel")}>取消</Button></div></div>)}</div>{error ? <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}</div>;
}

function MessageContent({ content, compact = false }: { content: string; compact?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const json = parseJsonMessage(content);
  if (!json) return <AgentMarkdown compact={compact} content={content} />;
  return (
    <div className="w-[min(360px,100%)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setIsExpanded((current) => !current)}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-control-soft)] text-[var(--color-text-secondary)]"><Code className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{content.replace(/\s+/g, " ").slice(0, 42)}</span><span className="block text-[11px] text-[var(--color-text-secondary)]">{isExpanded ? "收起 JSON" : "在文本框中显示"}</span></span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>
      {isExpanded ? <pre className="max-h-64 overflow-auto border-t border-[var(--color-border)] px-3 py-2 text-xs leading-5 whitespace-pre-wrap">{JSON.stringify(json, null, 2)}</pre> : null}
    </div>
  );
}

function parseJsonMessage(content: string): Record<string, unknown> | unknown[] | null {
  const normalized = unwrapJsonCodeBlock(content.trim());
  if (!(normalized.startsWith("{") || normalized.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(normalized);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> | unknown[] : null;
  } catch { return null; }
}

function unwrapJsonCodeBlock(content: string) {
  const match = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1]?.trim() ?? content;
}

function formatMessageTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function avatarLabel(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "我";
}

type SessionRow = { kind: "heading"; id: string; label: string } | { kind: "session"; id: string; session: AgentSession };

function VirtualSessionList({ sessions, activeSessionId, isLoading, onSelect, onAction }: {
  sessions: AgentSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  onSelect: (sessionId: string) => Promise<void>;
  onAction: (session: AgentSession, action: "pin" | "rename" | "delete") => Promise<void>;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const rows = useMemo(() => groupSessionRows(sessions), [sessions]);
  const rowHeight = 48;
  const viewportHeight = 800;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 4);

  if (!isLoading && rows.length === 0) return <p className="px-4 py-5 text-xs text-[var(--color-text-secondary)]">暂无历史会话</p>;

  return (
    <nav aria-label="Agent 历史对话" className="h-full overflow-y-auto px-2 pb-3" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="relative" style={{ height: rows.length * rowHeight }}>
        <div className="absolute inset-x-0" style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
          {rows.slice(startIndex, endIndex).map((row) => row.kind === "heading" ? (
            <div key={row.id} className="flex h-12 items-end px-2 pb-2 text-[11px] font-semibold text-[var(--color-text-disabled)]">{row.label}</div>
          ) : (
            <div key={row.id} className="group relative h-12">
              <button
                type="button"
                className={`relative h-full w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${row.session.id === activeSessionId ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"}`}
                onClick={() => void onSelect(row.session.id)}
              >
                {row.session.id === activeSessionId ? <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-[var(--color-primary)]" /> : null}
                <span className="block truncate">{row.session.title}</span>
              </button>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Dropdown>
                  <Dropdown.Trigger aria-label={`${row.session.title}更多操作`} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)] hover:bg-[var(--color-bg-hover)]">
                    <Ellipsis className="h-4 w-4" />
                  </Dropdown.Trigger>
                  <Dropdown.Popover>
                    <Dropdown.Menu aria-label="聊天记录操作">
                      <Dropdown.Item id="pin" onAction={() => void onAction(row.session, "pin")}>{row.session.isPinned ? "取消置顶" : "置顶"}</Dropdown.Item>
                      <Dropdown.Item id="rename" onAction={() => void onAction(row.session, "rename")}>重命名</Dropdown.Item>
                      <Dropdown.Item id="delete" onAction={() => void onAction(row.session, "delete")}>删除</Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </div>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}

function groupSessionRows(sessions: AgentSession[]): SessionRow[] {
  const groups = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const label = session.isPinned ? "置顶" : sessionTimeGroup(session.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), session]);
  }
  const labels = ["置顶", "今天", "昨天", "7天内", "30天内", ...[...groups.keys()].filter((label) => !["置顶", "今天", "昨天", "7天内", "30天内"].includes(label)).sort().reverse()];
  return labels.flatMap((label) => {
    const group = groups.get(label);
    return group?.length ? [{ kind: "heading" as const, id: `heading-${label}`, label }, ...group.map((session) => ({ kind: "session" as const, id: session.id, session }))] : [];
  });
}

function sessionTimeGroup(updatedAt: string) {
  const date = new Date(updatedAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((today - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return "7天内";
  if (days < 30) return "30天内";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  sessionId: string,
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
    const name = String(payload.name ?? "工具");
    setStatusText(`正在读取 ${toolLabel(name)}`);
    setMessages((current) => current.map((message) => {
      if (message.id !== assistantMessageId) return message;
      const activities = message.toolActivities ?? [];
      return {
        ...message,
        toolActivities: [...activities, {
          id: `${assistantMessageId}-tool-${activities.length + 1}`,
          name,
          status: "running",
        }],
      };
    }));
  } else if (eventName === "tool.completed") {
    setStatusText("已读取数据，正在整理回答");
    setMessages((current) => current.map((message) => {
      if (message.id !== assistantMessageId || !message.toolActivities?.length) return message;
      const activities = [...message.toolActivities];
      const index = activities.findLastIndex((tool) => tool.status === "running");
      if (index >= 0) activities[index] = { ...activities[index], status: "completed" };
      return { ...message, toolActivities: activities };
    }));
    const result = payload.result as { pendingAction?: { id?: string; summary?: string; type?: string; expiresInSeconds?: number } } | undefined;
    const action = result?.pendingAction;
    const actionId = action?.id;
    if (actionId) setMessages((current) => current.map((message) => message.id === assistantMessageId ? { ...message, pendingActions: [...(message.pendingActions ?? []), { id: actionId, summary: action?.summary ?? "Agent 提议执行写操作", actionType: action?.type ?? "", status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + Number(action?.expiresInSeconds ?? 86_400) * 1_000).toISOString() }] } : message));
  } else if (eventName === "status") {
    setStatusText("正在思考");
  } else if (eventName === "run.completed") {
    setStatusText("回答完成");
  } else if (eventName === "run.failed") {
    const message = typeof payload.message === "string" ? payload.message : "Agent 运行失败";
    setErrorMessage(message);
    setStatusText("运行失败");
  } else if (eventName === "message.completed") {
    const completed = payload.message as { runId?: unknown } | undefined;
    if (typeof completed?.runId === "string") {
      const runId = completed.runId;
      setMessages((current) => current.map((message) => message.id === assistantMessageId ? { ...message, runId } : message));
    }
  }
}

function toolLabel(name: string) {
  return ({ list_forms: "表单列表", get_form_schema: "表单 Schema", list_automations: "自动化列表", get_automation_graph: "自动化流程", call_plugin_tool: "插件工具" } as Record<string, string>)[name] ?? name;
}

function conversationTitle(content: string) {
  return content.replace(/\s+/g, " ").slice(0, 48) || "新对话";
}
