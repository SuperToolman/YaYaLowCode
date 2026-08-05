"use client";

import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowChevronLeft, ArrowChevronRight, ArrowDown, ChevronDown, Code, Ellipsis, FaceRobot, Gear, PaperPlane, Paperclip, Plus, Sparkles, Xmark } from "@gravity-ui/icons";
import { Button, Dropdown, Tabs } from "@heroui/react";
import { Drawer } from "@heroui/react/drawer";
import { AgentMarkdown } from "./agent-markdown";
import { useAuth } from "./auth-provider";
import {
  createAgentSessionData,
  deleteAgentSessionData,
  fetchAvailableAgents,
  fetchAgentMessages,
  fetchPendingActions,
  fetchAgentRunTrace,
  openAgentMessageStream,
  resolvePendingAction,
  updateAgentSessionData,
} from "@/features/agent-assistant/api";
import { parseAgentSseFrame } from "@/features/agent-assistant/sse";
import type {
  AgentMessage,
  AgentOption,
  AgentApprovalMode,
  AgentPageContext,
  AgentRunTrace,
  AgentSession,
  AttachedImage,
  PendingAction,
  SessionFilter,
} from "@/features/agent-assistant/types";
import { useAgentSessionsQuery } from "@/features/agent-assistant/hooks";

const suggestions = [
  "帮我分析当前应用结构",
  "当前表单有哪些字段？",
  "检查自动化流程是否合理",
  "帮我梳理当前数据关系",
  "这个页面有哪些可优化点？",
  "根据当前配置给出下一步建议",
];

const approvalModeLabels: Record<AgentApprovalMode, string> = {
  request_approval: "请求批准",
  approve_on_behalf: "替我审批",
  full_access: "完全访问",
};

const destructiveAgentActions = new Set(["delete_automation", "delete_navigation_group", "delete_form"]);

type AgentAssistantLauncherProps = {
  initialOpen?: boolean;
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function AgentAssistantLauncher({
  initialOpen = false,
  hideTrigger = false,
  open,
  onOpenChange,
}: AgentAssistantLauncherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const canConfigureAgents = hasPermission("settings.agent");
  const pageContext = useMemo(() => buildPageContext(pathname), [pathname]);
  const [internalOpen, setInternalOpen] = useState(initialOpen);
  const isOpen = open ?? internalOpen;
  const setIsOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange, open]);
  const { refetch: refetchAgentSessions } = useAgentSessionsQuery(isOpen);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [pendingImages, setPendingImages] = useState<AttachedImage[]>([]);
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>("approve_on_behalf");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState("准备就绪");
  const [errorMessage, setErrorMessage] = useState("");
  const [isNearMessagesBottom, setIsNearMessagesBottom] = useState(true);
  const localMessageSequence = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);

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

  useEffect(() => {
    resizeComposer(composerRef.current);
  }, [input]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const handleMessagesScroll = useCallback((container: HTMLDivElement) => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
      shouldAutoScrollRef.current = isNearBottom;
      setIsNearMessagesBottom((current) => current === isNearBottom ? current : isNearBottom);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedMode = window.localStorage.getItem("agent-approval-mode");
      if (savedMode === "request_approval" || savedMode === "approve_on_behalf" || savedMode === "full_access") {
        setApprovalMode(savedMode);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeApprovalMode = useCallback((mode: AgentApprovalMode) => {
    setApprovalMode(mode);
    window.localStorage.setItem("agent-approval-mode", mode);
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    const [messages, actions] = await Promise.all([
      fetchAgentMessages(sessionId),
      fetchPendingActions(sessionId).catch(() => []),
    ]);
    queryClient.setQueryData(["agent-messages", sessionId], messages);
    shouldAutoScrollRef.current = true;
    setIsNearMessagesBottom(true);
    setMessages(messages);
    setPendingActions(actions);
  }, [queryClient]);

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const loadedSessions = (await refetchAgentSessions()).data ?? [];
      const sortedSessions = [...loadedSessions].sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      setSessions(sortedSessions);
      const sessionId = preferredSessionId ?? sortedSessions[0]?.id ?? null;
      setActiveSessionId(sessionId);
      if (sessionId) {
        const session = sortedSessions.find((candidate) => candidate.id === sessionId);
        if (session) setSelectedAgentId(session.agentId);
        await loadMessages(sessionId);
      }
      else {
        setMessages([]);
        setPendingActions([]);
      }
      setStatusText("准备就绪");
    } catch (reason) {
      setStatusText("Agent 服务不可用");
      setErrorMessage(reason instanceof Error ? reason.message : "无法加载 Agent 会话");
    } finally {
      setIsLoading(false);
    }
  }, [loadMessages, refetchAgentSessions]);

  const loadAgents = useCallback(async () => {
    const loadedAgents = await fetchAvailableAgents(pageContext);
    setAgents(loadedAgents);
    setSelectedAgentId((current) => current ?? loadedAgents[0]?.id ?? null);
  }, [pageContext]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        await Promise.all([loadAgents(), loadSessions()]);
      })().catch((reason) => setErrorMessage(reason instanceof Error ? reason.message : "无法加载 Agent"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadAgents, loadSessions]);

  async function createSession(agentId = selectedAgentId ?? undefined) {
    const session = await createAgentSessionData(pageContext, agentId);
    queryClient.setQueryData<AgentSession[]>(["agent-sessions"], (current = []) => [session, ...current]);
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setSelectedAgentId(session.agentId);
    setMessages([]);
    setPendingActions([]);
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
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (session) setSelectedAgentId(session.agentId);
    setIsLoading(true);
    setErrorMessage("");
    try {
      await queryClient.invalidateQueries({ queryKey: ["agent-messages", sessionId] });
      await loadMessages(sessionId);
      setStatusText("准备就绪");
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : "无法加载 Agent 消息");
    } finally {
      setIsLoading(false);
    }
  }

  async function selectAgent(agentId: string) {
    if (agentId === selectedAgentId || isStreaming) return;
    const previousAgentId = selectedAgentId;
    setSelectedAgentId(agentId);
    setErrorMessage("");
    const existingSession = sessions.find((session) => session.agentId === agentId);
    if (existingSession) {
      await selectSession(existingSession.id);
      return;
    }
    setIsLoading(true);
    try {
      await createSession(agentId);
      setStatusText("准备就绪");
    } catch (reason) {
      setSelectedAgentId(previousAgentId);
      setErrorMessage(reason instanceof Error ? reason.message : "无法切换机器人");
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
    let pendingDelta = "";
    let deltaTimer: number | null = null;
    const flushDelta = () => {
      deltaTimer = null;
      if (!pendingDelta) return;
      const delta = pendingDelta;
      pendingDelta = "";
      setMessages((current) => updateAssistantDelta(current, assistantMessageId, delta));
    };
    const enqueueDelta = (delta: string) => {
      pendingDelta += delta;
      if (deltaTimer === null) deltaTimer = window.setTimeout(flushDelta, 40);
    };

    try {
      const sessionId = activeSessionId ?? await createSession();
      shouldAutoScrollRef.current = true;
      setIsNearMessagesBottom(true);
      setMessages((current) => [
        ...current,
        { id: `local-user-${messageSequence}`, role: "user", content: normalized, attachments, createdAt },
        { id: assistantMessageId, role: "assistant", content: "", createdAt, toolActivities: [] },
      ]);
      const response = await openAgentMessageStream(sessionId, normalized, pageContext, approvalMode);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        frames.forEach((frame) => handleSseFrame(frame, assistantMessageId, approvalMode, enqueueDelta, setMessages, setPendingActions, setStatusText, setErrorMessage));
        if (done) {
          if (buffer.trim()) {
            handleSseFrame(buffer, assistantMessageId, approvalMode, enqueueDelta, setMessages, setPendingActions, setStatusText, setErrorMessage);
          }
          break;
        }
      }
      if (deltaTimer !== null) {
        window.clearTimeout(deltaTimer);
        flushDelta();
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
      if (deltaTimer !== null) {
        window.clearTimeout(deltaTimer);
        flushDelta();
      }
      setIsStreaming(false);
    }
  }

  async function updateSession(sessionId: string, update: { title?: string; isPinned?: boolean }) {
    const updatedSession = await updateAgentSessionData(sessionId, update);
    queryClient.setQueryData<AgentSession[]>(["agent-sessions"], (current = []) => current.map((session) => session.id === sessionId ? updatedSession : session));
    setSessions((current) => current.map((session) => session.id === sessionId ? updatedSession : session)
      .sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)));
  }

  async function deleteSession(sessionId: string) {
    await deleteAgentSessionData(sessionId);
    queryClient.setQueryData<AgentSession[]>(["agent-sessions"], (current = []) => current.filter((session) => session.id !== sessionId));
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
      setPendingActions([]);
    }
  }

  async function handlePendingActions(
    actions: PendingAction[],
    operation: "confirm" | "cancel",
    continueAfter = false,
  ) {
    if (!activeSessionId || actions.length === 0) return;
    let completed = false;
    try {
      for (const action of actions) {
        await resolvePendingAction(activeSessionId, action.id, operation);
      }
      completed = true;
      const handledIds = new Set(actions.map((action) => action.id));
      setPendingActions((current) => current.filter((action) => !handledIds.has(action.id)));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["agent-messages", activeSessionId] });
      await loadMessages(activeSessionId);
    }
    if (completed && continueAfter && operation === "confirm") {
      await sendMessage("以上待确认操作已全部确认。请立即校验实际执行结果，并继续完成我最初的任务；不要只做总结。若仍需确认，请合并为一个批次。");
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
      {!hideTrigger ? <button
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
      </button> : null}

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

              <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2">
                <div className="flex min-h-11 items-center gap-2 overflow-x-auto" aria-label="机器人列表">
                  {agents.map((agent) => {
                    const isSelected = agent.id === selectedAgentId;
                    return <button
                      key={agent.id}
                      type="button"
                      aria-pressed={isSelected}
                      title={agent.description || agent.name}
                      disabled={isStreaming || isLoading}
                      className={`flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isSelected ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]" : "border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-text-primary)]"}`}
                      onClick={() => void selectAgent(agent.id)}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-control-soft)]"><FaceRobot className="h-3.5 w-3.5" /></span>
                      <span className="max-w-36 truncate">{agent.name}</span>
                    </button>;
                  })}
                  {!agents.length && !isLoading ? <span className="px-1 text-xs text-[var(--color-text-secondary)]">暂无可用机器人</span> : null}
                </div>
              </div>

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
                      onScroll={(event) => handleMessagesScroll(event.currentTarget)}
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
                        <VirtualMessageList
                          messages={messages}
                          scrollRef={messagesContainerRef}
                          sessionId={activeSessionId}
                          userName={user?.displayName ?? user?.username ?? "我"}
                        />
                      )}
                    </div>

                    <div className="relative bg-[var(--color-bg-canvas)] px-4 pb-5 pt-3">
                      {hasMessages && !isNearMessagesBottom ? <Button isIconOnly aria-label="回到最新消息" className="absolute bottom-full right-4 mb-3 h-9 w-9 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]" onClick={scrollMessagesToBottom}><ArrowDown className="h-4 w-4" /></Button> : null}
                      {pendingActions.length ? <ApprovalTray actions={pendingActions} mode={approvalMode} onAction={handlePendingActions} /> : null}
                      <div className="mx-auto max-w-[800px] rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2 shadow-[var(--shadow-sm)] focus-within:border-[var(--color-primary)] focus-within:ring-4 focus-within:ring-[var(--color-primary-soft)]">
                        {pendingImages.length ? <div className="flex flex-wrap gap-2 px-1 pb-2">{pendingImages.map((image) => <div key={image.id} className="group relative h-14 w-14 overflow-hidden rounded-md border border-[var(--color-border)]"><Image src={image.previewUrl} alt={image.name} width={56} height={56} unoptimized className="h-full w-full object-cover" /><button type="button" aria-label={`移除 ${image.name}`} className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex" onClick={() => removePendingImage(image.id)}><Xmark className="h-3 w-3" /></button></div>)}</div> : null}
                        <textarea ref={composerRef} aria-label="给 Agent 发送消息" className="min-h-10 w-full resize-none overflow-y-hidden bg-transparent px-2 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]" placeholder="询问当前应用、表单或自动化…" rows={1} value={input} disabled={isStreaming} onChange={(event) => setInput(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
                        <div className="mt-1 flex h-10 items-center justify-between border-t border-[var(--color-border)]/70 px-1 pt-1">
                          <input ref={imageInputRef} aria-label="上传图片" className="hidden" type="file" accept="image/*" multiple onChange={(event) => { addImages(event.currentTarget.files); event.currentTarget.value = ""; }} />
                          <div className="flex items-center gap-1">
                            <Button isIconOnly variant="ghost" aria-label="上传图片" className="h-9 min-h-9 w-9 min-w-9 rounded-lg text-[var(--color-text-secondary)]" isDisabled={isStreaming} onPress={() => imageInputRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
                            <Dropdown>
                              <Dropdown.Trigger aria-label="批准操作" className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                                <span>{approvalModeLabels[approvalMode]}</span><ChevronDown className="h-3 w-3" />
                              </Dropdown.Trigger>
                              <Dropdown.Popover>
                                <Dropdown.Menu aria-label="批准操作" className="min-w-64">
                                  <Dropdown.Item id="request_approval" textValue="请求批准" onAction={() => changeApprovalMode("request_approval")}><div><div className="text-sm">请求批准{approvalMode === "request_approval" ? " ✓" : ""}</div><div className="text-xs text-[var(--color-text-secondary)]">每个写操作都需要确认</div></div></Dropdown.Item>
                                  <Dropdown.Item id="approve_on_behalf" textValue="替我审批" onAction={() => changeApprovalMode("approve_on_behalf")}><div><div className="text-sm">替我审批{approvalMode === "approve_on_behalf" ? " ✓" : ""}</div><div className="text-xs text-[var(--color-text-secondary)]">自动批准，删除等危险操作除外</div></div></Dropdown.Item>
                                  <Dropdown.Item id="full_access" textValue="完全访问" onAction={() => changeApprovalMode("full_access")}><div><div className="text-sm">完全访问{approvalMode === "full_access" ? " ✓" : ""}</div><div className="text-xs text-[var(--color-text-secondary)]">所有允许的操作均不确认</div></div></Dropdown.Item>
                                </Dropdown.Menu>
                              </Dropdown.Popover>
                            </Dropdown>
                          </div>
                          <Button isIconOnly aria-label="发送消息" className="h-9 min-h-9 w-9 min-w-9 rounded-lg bg-[var(--color-primary)] p-0 text-[var(--color-text-on-primary)] disabled:opacity-40" isDisabled={!input.trim() || isStreaming} onClick={() => void sendMessage()}><PaperPlane className="h-4 w-4" /></Button>
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

type PendingActionHandler = (actions: PendingAction[], operation: "confirm" | "cancel", continueAfter?: boolean) => Promise<void>;

const MessageRow = memo(function MessageRow({ message, sessionId, userName }: { message: AgentMessage; sessionId: string | null; userName: string }) {
  const isUser = message.role === "user";
  return (
    <div className="relative w-full px-[44px]" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}>
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
          ) : <span className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-primary)]" />正在思考…</span>}
          {message.role === "assistant" && message.toolActivities?.length ? <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">{message.toolActivities.map((tool) => <span key={tool.id} className={tool.status === "completed" ? "inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--color-success-soft)] px-2 py-1 text-[11px] text-[var(--color-success)]" : "inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--color-primary-soft)] px-2 py-1 text-[11px] text-[var(--color-primary)]"}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tool.status === "completed" ? "bg-[var(--color-success)]" : "animate-pulse bg-[var(--color-primary)]"}`} /><span className="truncate">{tool.status === "completed" ? "已查询" : "查询中"} {toolLabel(tool.name)}{tool.resourceName ? ` · ${tool.resourceName}` : ""}</span></span>)}</div> : null}
          {message.role === "assistant" && message.runId && sessionId ? <RunTracePanel sessionId={sessionId} runId={message.runId} /> : null}
        </div>
      </div>
    </div>
  );
});

function VirtualMessageList({ messages, scrollRef, sessionId, userName }: {
  messages: AgentMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
  sessionId: string | null;
  userName: string;
}) {
  const shouldVirtualize = messages.length > 40;
  // TanStack Virtual intentionally returns mutable measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? messages.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 132,
    overscan: 8,
  });

  if (!shouldVirtualize) {
    return (
      <div className="mx-auto w-full max-w-[888px] space-y-6 py-6">
        {messages.map((message) => <MessageRow key={message.id} message={message} sessionId={sessionId} userName={userName} />)}
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[888px]" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const message = messages[item.index];
        return (
          <div
            key={message.id}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className="absolute left-0 top-0 w-full pb-6"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <MessageRow message={message} sessionId={sessionId} userName={userName} />
          </div>
        );
      })}
    </div>
  );
}

function RunTracePanel({ sessionId, runId }: { sessionId: string; runId: string }) {
  const [trace, setTrace] = useState<AgentRunTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function loadTrace() {
    setLoading(true); setError("");
    try {
      const nextTrace = await fetchAgentRunTrace(sessionId, runId);
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

function ApprovalTray({ actions, mode, onAction }: { actions: PendingAction[]; mode: AgentApprovalMode; onAction: PendingActionHandler }) {
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const perform = async (selected: PendingAction[], operation: "confirm" | "cancel", continueAfter = false) => {
    setError("");
    setBusyKey(selected.length === actions.length ? "all" : selected[0]?.id ?? null);
    try {
      await onAction(selected, operation, continueAfter);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusyKey(null);
    }
  };
  const hasDestructiveAction = actions.some((action) => destructiveAgentActions.has(action.actionType));
  return <div className="mx-auto mb-2 max-w-[800px] rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-bg-surface)] px-3 py-2.5 shadow-[var(--shadow-sm)]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className={`text-sm font-medium ${hasDestructiveAction ? "text-[var(--color-danger)]" : "text-[var(--color-text-primary)]"}`}>{hasDestructiveAction ? "需要确认危险操作" : "Agent 正在等待批准"}</p><p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{actions.length} 项操作 · {approvalModeLabels[mode]}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" isDisabled={busyKey !== null} onPress={() => void perform(actions, "cancel")}>拒绝</Button><Button size="sm" isPending={busyKey !== null} isDisabled={busyKey !== null} className={hasDestructiveAction ? "bg-[var(--color-danger)] text-white" : undefined} onPress={() => void perform(actions, "confirm", true)}>{hasDestructiveAction ? "允许删除" : "允许"}</Button></div></div><div className="mt-2 max-h-24 space-y-1 overflow-y-auto border-t border-[var(--color-border)] pt-2">{actions.map((action) => <p key={action.id} className="truncate text-xs text-[var(--color-text-secondary)]">{action.summary}</p>)}</div>{error ? <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}</div>;
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
  approvalMode: AgentApprovalMode,
  enqueueDelta: (delta: string) => void,
  setMessages: Dispatch<SetStateAction<AgentMessage[]>>,
  setPendingActions: Dispatch<SetStateAction<PendingAction[]>>,
  setStatusText: Dispatch<SetStateAction<string>>,
  setErrorMessage: Dispatch<SetStateAction<string>>,
) {
  const event = parseAgentSseFrame(frame);
  if (!event) return;

  switch (event.type) {
  case "message.delta":
    enqueueDelta(event.delta);
    break;
  case "tool.started":
    setStatusText(`正在读取 ${toolLabel(event.name)}`);
    setMessages((current) => current.map((message) => {
      if (message.id !== assistantMessageId) return message;
      const activities = message.toolActivities ?? [];
      return {
        ...message,
        toolActivities: [...activities, {
          id: `${assistantMessageId}-tool-${activities.length + 1}`,
          name: event.name,
          resourceName: event.resourceName,
          status: "running",
        }],
      };
    }));
    break;
  case "tool.completed":
    setStatusText("已读取数据，正在整理回答");
    setMessages((current) => current.map((message) => {
      if (message.id !== assistantMessageId || !message.toolActivities?.length) return message;
      const activities = [...message.toolActivities];
      const index = activities.findLastIndex((tool) => tool.status === "running");
      if (index >= 0) activities[index] = { ...activities[index], status: "completed" };
      return { ...message, toolActivities: activities };
    }));
    if (event.pendingAction && (approvalMode === "request_approval" || (approvalMode === "approve_on_behalf" && destructiveAgentActions.has(event.pendingAction.actionType)))) {
      const action = event.pendingAction;
      setPendingActions((current) => current.some((item) => item.id === action.id) ? current : [...current, { id: action.id, summary: action.summary, actionType: action.actionType, status: "pending", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + action.expiresInSeconds * 1_000).toISOString() }]);
    }
    break;
  case "status":
    setStatusText("正在思考");
    break;
  case "run.completed":
    setStatusText("回答完成");
    break;
  case "run.failed":
  case "message.failed":
    setErrorMessage(event.message);
    setStatusText("运行失败");
    break;
  case "message.completed":
    if (event.runId) setMessages((current) => current.map((message) => message.id === assistantMessageId ? { ...message, runId: event.runId } : message));
    break;
  case "unknown":
    break;
  }
}

function updateAssistantDelta(messages: AgentMessage[], assistantMessageId: string, delta: string) {
  return messages.map((message) => message.id === assistantMessageId
    ? { ...message, content: message.content + delta }
    : message);
}

function resizeComposer(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  const styles = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
  const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
  const maxHeight = lineHeight * 13 + verticalPadding;
  element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
}

function toolLabel(name: string) {
  return ({
    list_apps: "应用列表",
    get_application_business_context: "应用业务地图",
    list_forms: "表单列表",
    list_navigation_groups: "导航分组",
    create_navigation_group: "创建导航分组",
    delete_navigation_group: "删除导航分组",
    get_form_schema: "表单 Schema",
    get_form_relationships: "表单关系",
    list_form_records: "表单记录",
    query_form_records: "查询记录",
    aggregate_form_records: "汇总记录",
    create_form_draft: "创建表单",
    move_form_to_group: "移动表单",
    publish_form: "发布表单",
    delete_form: "删除表单",
    save_form_schema_draft: "保存 Schema",
    list_automations: "自动化列表",
    get_automation_graph: "自动化流程",
    create_automation_draft: "创建自动化",
    delete_automation: "删除自动化",
    call_plugin_tool: "插件工具",
  } as Record<string, string>)[name] ?? name;
}

function conversationTitle(content: string) {
  return content.replace(/\s+/g, " ").slice(0, 48) || "新对话";
}
