"use client";
/* eslint-disable @next/next/no-img-element -- authenticated attachment URLs cannot use the server-side image optimizer */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button, Card, Checkbox, Input, Modal, Popover, Tabs, TextArea, Tooltip } from "@heroui/react";
import { Comment, Envelope, FaceSmile, PaperPlane, Paperclip, Plus } from "@gravity-ui/icons";
import { useAuth } from "../../components/auth-provider";
import {
  createDirectConversation, createGroupConversation, listCommunicationConversations,
  listCommunicationMessages, listCommunicationUsers, markCommunicationConversationRead,
  recallCommunicationMessage, reeditCommunicationMessage, sendCommunicationMessage,
  updateGroupConversation,
  type CommunicationConversationResponse, type CommunicationMessageResponse, type CommunicationUserResponse,
} from "@/features/communication/api";

const EMOJIS = ["😀", "😂", "😊", "😍", "👍", "👏", "🎉", "❤️", "🙏", "🤔", "😢", "🔥"];
type ApiResult<T> = { data?: T; error?: unknown };
type UiMessage = CommunicationMessageResponse & { deliveryState?: "sending" | "failed" | "delivered" };
type MentionComposerHandle = { insertText: (value: string) => void };

function createClientMessageId() {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  // randomUUID is unavailable on some HTTP origins; this remains unique enough
  // for the message endpoint's idempotency key.
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export default function MessagesPage() {
  const { token, user } = useAuth();
  const [conversations, setConversations] = useState<CommunicationConversationResponse[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [nextBeforeSequence, setNextBeforeSequence] = useState<number | null>(null);
  const [realtimeOnline, setRealtimeOnline] = useState(false);
  const [communicationAvailable, setCommunicationAvailable] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [reediting, setReediting] = useState<CommunicationMessageResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerEditor = useRef<MentionComposerHandle>(null);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSentAt = useRef(0);
  const typingExpiryTimers = useRef(new Map<string, number>());
  const presenceExpiryTimers = useRef(new Map<string, number>());

  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  const loadConversations = useCallback(async () => {
    const result = await listCommunicationConversations() as ApiResult<{ code: number; data: CommunicationConversationResponse[] | null; message: string }>;
    if (result.error || !result.data?.data) {
      setCommunicationAvailable(false);
      throw new Error(result.data?.message ?? messageOf(result.error) ?? "无法加载会话");
    }
    setCommunicationAvailable(true);
    setConversations(result.data.data);
    setSelectedId((current) => current ?? result.data!.data![0]?.id ?? null);
  }, []);

  const markConversationRead = useCallback(async (conversationId: string, sequence: number) => {
    await markCommunicationConversationRead({ path: { conversationId }, body: { sequence } });
    setConversations((current) => current.map((item) => item.id === conversationId
      ? { ...item, unreadCount: 0 }
      : item));
    window.dispatchEvent(new Event("yaya-communication-read-updated"));
  }, []);

  const loadMessages = useCallback(async (conversationId: string, beforeSequence?: number) => {
    const result = await listCommunicationMessages({ path: { conversationId }, query: { limit: 50, beforeSequence } }) as ApiResult<{ code: number; data: { items: CommunicationMessageResponse[]; nextBeforeSequence?: number | null } | null; message: string }>;
    if (result.error || !result.data?.data) throw new Error(result.data?.message ?? "无法加载消息");
    setMessages((current) => beforeSequence ? [...result.data!.data!.items, ...current] : result.data!.data!.items);
    setNextBeforeSequence(result.data.data.nextBeforeSequence ?? null);
    const sequence = result.data.data.items.at(-1)?.sequence;
    if (sequence) await markConversationRead(conversationId, sequence);
  }, [markConversationRead]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/communication/status", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { code: number; data: { enabled?: boolean } | null; message?: string };
          if (!response.ok || payload.code !== 0) throw new Error(payload.message || "无法读取通讯模块状态");
          if (!payload.data?.enabled) {
            setCommunicationAvailable(false);
            setError("通讯模块尚未激活，请联系系统管理员启用。");
            return;
          }
          return loadConversations();
        })
        .catch((cause) => setError(messageOf(cause)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations]);
  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    updateCurrentTime();
    const timer = window.setInterval(updateCurrentTime, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => void loadMessages(selectedId).then(loadConversations).catch((cause) => setError(messageOf(cause))), 0);
    return () => window.clearTimeout(timer);
  }, [selectedId, loadMessages, loadConversations]);

  useEffect(() => {
    if (!token || !communicationAvailable) return;
    let socket: WebSocket | null = null;
    let timer = 0;
    let stopped = false;
    let attempt = 0;
    let presenceHeartbeat = 0;
    const typingTimers = typingExpiryTimers.current;
    const presenceTimers = presenceExpiryTimers.current;
    const refreshUserExpiry = (kind: "typing" | "presence", userId: string) => {
      const timers = kind === "typing" ? typingTimers : presenceTimers;
      const existing = timers.get(userId);
      if (existing) window.clearTimeout(existing);
      const timeout = window.setTimeout(() => {
        timers.delete(userId);
        if (kind === "typing") setTypingUsers((current) => current.filter((id) => id !== userId));
        else setOnlineUsers((current) => current.filter((id) => id !== userId));
      }, kind === "typing" ? 2_000 : 45_000);
      timers.set(userId, timeout);
    };
    const sendPresence = () => {
      if (selectedId && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "conversation.presence", conversationId: selectedId }));
    };
    const connect = () => {
      const configuredUrl = process.env.NEXT_PUBLIC_BACKEND_WS_URL?.trim();
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const defaultPort = location.port === "3000" ? "8787" : location.port === "8801" ? "8802" : location.port;
      const url = configuredUrl
        ? (location.protocol === "https:" && configuredUrl.startsWith("ws://")
          ? `wss://${configuredUrl.slice("ws://".length)}`
          : configuredUrl)
        : `${protocol}//${location.hostname}${defaultPort ? `:${defaultPort}` : ""}/api/communication/ws`;
      socket = new WebSocket(url, ["yaya-chat", token]);
      socketRef.current = socket;
      socket.onopen = () => { attempt = 0; setRealtimeOnline(true); sendPresence(); window.clearInterval(presenceHeartbeat); presenceHeartbeat = window.setInterval(sendPresence, 20_000); };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; data?: CommunicationMessageResponse & { conversationId?: string; userId?: string; typing?: boolean; sequence?: number } };
          if (payload.type === "conversation.typing" && payload.data?.userId && payload.data.userId !== user?.id) {
            const userId = payload.data.userId;
            setTypingUsers((current) => payload.data!.typing ? [...new Set([...current, userId])] : current.filter((id) => id !== userId));
            if (payload.data.typing) refreshUserExpiry("typing", userId);
          }
          if (payload.type === "conversation.presence" && payload.data?.userId && payload.data.userId !== user?.id) {
            const userId = payload.data.userId;
            setOnlineUsers((current) => [...new Set([...current, userId])]);
            refreshUserExpiry("presence", userId);
          }
          if (payload.type === "message.created" && payload.data?.id) {
            const isOpenConversation = payload.data.conversationId === selectedId;
            if (isOpenConversation) {
              setMessages((current) => current.some((item) => item.id === payload.data!.id) ? current : [...current.filter((item) => !item.id.startsWith("pending-")), payload.data!]);
              if (payload.data.sequence) void markConversationRead(payload.data.conversationId!, payload.data.sequence).catch((cause) => setError(messageOf(cause)));
            }
            setConversations((current) => current.map((item) => item.id === payload.data!.conversationId ? { ...item, lastMessageAt: payload.data!.createdAt, lastMessageSequence: payload.data!.sequence, lastMessagePreview: previewMessage(payload.data!), unreadCount: isOpenConversation ? 0 : item.unreadCount } : item).sort((left, right) => (right.lastMessageAt ?? "").localeCompare(left.lastMessageAt ?? "")));
          } else if (payload.type === "message.recalled" && payload.data?.id) {
            setMessages((current) => current.map((item) => item.id === payload.data!.id ? payload.data! : item));
            void loadConversations();
          }
        } catch { /* Ignore malformed server events. */ }
      };
      socket.onclose = () => { window.clearInterval(presenceHeartbeat); setRealtimeOnline(false); setOnlineUsers([]); setTypingUsers([]); if (!stopped) timer = window.setTimeout(() => { void Promise.all([loadConversations(), selectedId ? loadMessages(selectedId) : Promise.resolve()]).then(() => { if (!stopped) connect(); }).catch((cause) => setError(messageOf(cause))); }, Math.min(30_000, 1000 * 2 ** attempt++)); };
    };
    connect();
    return () => { stopped = true; window.clearTimeout(timer); window.clearInterval(presenceHeartbeat); typingTimers.forEach(window.clearTimeout); presenceTimers.forEach(window.clearTimeout); typingTimers.clear(); presenceTimers.clear(); socket?.close(); };
  }, [token, communicationAvailable, selectedId, user?.id, loadConversations, loadMessages, markConversationRead]);

  async function send(messageType: string, content: string, fileIds: string[] = [], subject?: string) {
    if (!selectedId || (!content.trim() && fileIds.length === 0)) return;
    const temporaryId = `pending-${createClientMessageId()}`;
    if (!reediting) setMessages((current) => [...current, { id: temporaryId, conversationId: selectedId, senderUserId: user?.id ?? "", sequence: Number.MAX_SAFE_INTEGER, messageType, content: content.trim(), emailSubject: subject, fileIds, attachments: [], status: "active", createdAt: new Date().toISOString(), deliveryState: "sending" }]);
    setBusy(true); setError("");
    try {
      if (reediting) {
        await reeditCommunicationMessage({ path: { conversationId: selectedId, messageId: reediting.id }, body: { content: content.trim(), fileIds, emailSubject: subject, clientMessageId: createClientMessageId() } });
        setReediting(null);
      } else {
        await sendCommunicationMessage({ path: { conversationId: selectedId }, body: { messageType, content: content.trim(), fileIds, emailSubject: subject, clientMessageId: createClientMessageId() } });
      }
      setComposer(""); await Promise.all([loadMessages(selectedId), loadConversations()]);
    } catch (cause) { setMessages((current) => current.map((item) => item.id === temporaryId ? { ...item, deliveryState: "failed" } : item)); setError(messageOf(cause)); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    if (!selectedId) return;
    setBusy(true); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/files/upload", { method: "POST", body });
      const payload = await response.json() as { code: number; data: { fileId: string } | null; message: string };
      if (!response.ok || !payload.data) throw new Error(payload.message || "文件上传失败");
      await send("file", file.name, [payload.data.fileId]);
    } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); }
  }

  async function recall(message: CommunicationMessageResponse) {
    if (!selectedId) return;
    try {
      await recallCommunicationMessage({ path: { conversationId: selectedId, messageId: message.id }, body: {} });
      await loadMessages(selectedId);
    } catch (cause) { setError(messageOf(cause)); }
  }

  function beginReedit(message: CommunicationMessageResponse) {
    setReediting(message); setComposer(message.content); setEmailSubject(message.emailSubject ?? "");
  }

  function updateComposer(value: string) {
    setComposer(value);
    if (!selectedId || socketRef.current?.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (value && now - lastTypingSentAt.current >= 500) {
      socketRef.current.send(JSON.stringify({ type: "conversation.typing", conversationId: selectedId, typing: true }));
      lastTypingSentAt.current = now;
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => socketRef.current?.send(JSON.stringify({ type: "conversation.typing", conversationId: selectedId, typing: false })), 1500);
  }

  return <main className="theme-page-shell h-full min-h-0">
    <Card className="grid h-full min-h-0 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-[var(--color-border)] lg:border-b-0 lg:border-r">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4"><div><h1 className="text-base font-semibold text-[var(--color-text-primary)]">消息</h1><p className="text-xs text-[var(--color-text-secondary)]">{conversations.length} 个会话</p></div><Tooltip><Tooltip.Trigger><Button isIconOnly variant="ghost" aria-label="新建会话" onPress={() => setNewOpen(true)}><Plus className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>新建会话</Tooltip.Content></Tooltip></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{conversations.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left ${item.id === selectedId ? "bg-[var(--color-control-selected)]" : "hover:bg-[var(--color-control-soft-hover)]"}`}><Avatar name={item.title} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{item.title}</span><span className="block truncate text-xs text-[var(--color-text-secondary)]">{item.lastMessagePreview ?? (item.conversationType === "group" ? `${item.members.length} 位成员` : "单聊")}</span></span>{item.unreadCount > 0 ? <span className="min-w-5 rounded-full bg-[var(--color-danger)] px-1.5 text-center text-xs text-white">{item.unreadCount > 99 ? "99+" : item.unreadCount}</span> : null}</button>)}{conversations.length === 0 ? <Empty text="暂无会话" /> : null}</div>
      </aside>
      <section className="flex min-h-0 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5"><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{selected?.title ?? "选择会话"}</h2><p className="text-xs text-[var(--color-text-secondary)]">{typingUsers.length ? "对方正在输入…" : selected ? `${realtimeOnline ? "实时连接正常" : "正在重连"}${onlineUsers.length ? ` · ${onlineUsers.length} 人在线` : ""} · ${selected.members.map((member) => member.displayName).join("、")}` : "从左侧选择一条会话"}</p></div>{selected?.conversationType === "group" && selected.members.some((member) => member.userId === user?.id && member.role === "owner") ? <Button size="sm" variant="ghost" onPress={() => setManageOpen(true)}>管理群聊</Button> : null}</header>
        {error ? <div className="border-b border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-2 text-xs text-[var(--color-danger)]">{error}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{selected ? <div className="mx-auto flex flex-col gap-4">{nextBeforeSequence ? <Button size="sm" variant="ghost" className="self-center" onPress={() => selectedId && void loadMessages(selectedId, nextBeforeSequence)}>加载更早消息</Button> : null}{messages.map((message) => { const sender = selected.members.find((member) => member.userId === message.senderUserId); const mine = message.senderUserId === user?.id; const myRole = selected.members.find((member) => member.userId === user?.id)?.role; const canRecall = mine && ((currentTime !== null && currentTime - new Date(message.createdAt).getTime() < 2 * 60_000) || (selected.conversationType === "group" && (myRole === "owner" || myRole === "admin"))); return <MessageBubble key={message.id} message={message} mine={mine} canRecall={canRecall} senderName={sender?.displayName ?? (mine ? user?.displayName ?? "当前用户" : "成员")} senderAvatarUrl={sender?.avatarUrl} onRecall={() => void recall(message)} onReedit={() => beginReedit(message)} onRetry={() => { setMessages((current) => current.filter((item) => item.id !== message.id)); void send(message.messageType, message.content, message.fileIds, message.emailSubject ?? undefined); }} />; })}{messages.length === 0 ? <Empty text="还没有消息" /> : null}</div> : <Empty text="没有选中的会话" />}</div>
        <footer className="shrink-0">{reediting ? <div className="mb-2 flex items-center justify-between rounded-md bg-[var(--color-primary-soft)] px-3 py-2 text-xs text-[var(--color-primary)]"><span>正在重新编辑撤回的消息</span><Button size="sm" variant="ghost" onPress={() => { setReediting(null); setComposer(""); }}>取消</Button></div> : null}<div className="flex h-40 min-h-32 flex-col overflow-visible rounded-md border border-[var(--color-border)] bg-[var(--color-bg-input)]"><MentionComposer ref={composerEditor} value={composer} members={selected?.conversationType === "group" ? selected.members : []} disabled={!selected} placeholder={selected ? "输入消息" : "选择会话后输入消息"} onChange={updateComposer} onSend={() => void send(reediting?.messageType ?? "text", composer, reediting?.fileIds ?? [], reediting?.emailSubject ?? undefined)} /><div className="flex h-10 shrink-0 items-center justify-between px-2"><div className="flex shrink-0 gap-1"><Popover><Popover.Trigger><Button isIconOnly variant="ghost" aria-label="发送表情" isDisabled={!selected}><FaceSmile className="h-4 w-4" /></Button></Popover.Trigger><Popover.Content className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-floating)]"><Popover.Dialog aria-label="选择表情" className="grid w-52 grid-cols-6">{EMOJIS.map((emoji) => <Button key={emoji} isIconOnly variant="ghost" onPress={() => composerEditor.current?.insertText(emoji)}>{emoji}</Button>)}</Popover.Dialog></Popover.Content></Popover><ToolButton label="发送文件" disabled={!selected || busy} onPress={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" /></ToolButton><ToolButton label="发送邮件" disabled={!selected || busy} onPress={() => setEmailOpen(true)}><Envelope className="h-4 w-4" /></ToolButton><input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></div><Tooltip><Tooltip.Trigger><Button isIconOnly aria-label="发送消息" isDisabled={!selected || !composer.trim() || busy} onPress={() => void send(reediting?.messageType ?? "text", composer, reediting?.fileIds ?? [], reediting?.emailSubject ?? undefined)}><PaperPlane className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>发送消息</Tooltip.Content></Tooltip></div></div></footer>
      </section>
    </Card>
    <NewConversationModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); void loadConversations().then(() => setSelectedId(id)); }} />
    {selected ? <ManageGroupModal open={manageOpen} conversation={selected} onClose={() => setManageOpen(false)} onSaved={() => { setManageOpen(false); void loadConversations(); }} /> : null}
    <Modal isOpen={emailOpen} onOpenChange={setEmailOpen}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="md"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>发送邮件消息</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><Modal.Body className="space-y-3"><Input autoFocus fullWidth placeholder="邮件主题" value={emailSubject} onChange={(event) => setEmailSubject(event.currentTarget.value)} /><TextArea fullWidth className="min-h-36" placeholder="邮件正文" value={emailBody} onChange={(event) => setEmailBody(event.currentTarget.value)} /></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => setEmailOpen(false)}>取消</Button><Button isDisabled={!emailSubject.trim() || !emailBody.trim()} onPress={() => { void send("email", emailBody, [], emailSubject); setEmailOpen(false); setEmailBody(""); setEmailSubject(""); }}>发送</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </main>;
}

const MentionComposer = forwardRef<MentionComposerHandle, { value: string; members: CommunicationConversationResponse["members"]; disabled: boolean; placeholder: string; onChange: (value: string) => void; onSend: () => void }>(function MentionComposer({ value, members, disabled, placeholder, onChange, onSend }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const emittedValue = useRef("");
  const [query, setQuery] = useState<string | null>(null);
  const filteredMembers = query === null ? [] : members.filter((member) => member.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  useEffect(() => {
    if (value === emittedValue.current || !editorRef.current) return;
    editorRef.current.textContent = value;
    emittedValue.current = value;
    setQuery(null);
  }, [value]);
  useImperativeHandle(ref, () => ({ insertText(text) {
    editorRef.current?.focus();
    document.execCommand("insertText", false, text);
    syncEditor();
  } }));

  function syncEditor() {
    const nextValue = editorRef.current?.textContent ?? "";
    emittedValue.current = nextValue;
    onChange(nextValue);
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || !editorRef.current?.contains(node)) return setQuery(null);
    const text = node.nodeType === Node.TEXT_NODE ? node.textContent?.slice(0, selection?.anchorOffset ?? 0) ?? "" : "";
    const atIndex = text.lastIndexOf("@");
    const nextQuery = atIndex >= 0 && !/\s/.test(text.slice(atIndex + 1)) ? text.slice(atIndex + 1) : null;
    setQuery(nextQuery !== null && members.some((member) => member.displayName.toLocaleLowerCase().includes(nextQuery.toLocaleLowerCase())) ? nextQuery : null);
  }

  function insertMentions(items: CommunicationConversationResponse["members"] | "all") {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!editor || !selection || !node || node.nodeType !== Node.TEXT_NODE) return;
    const textNode = node as Text;
    const end = selection.anchorOffset;
    const at = textNode.data.lastIndexOf("@", end);
    if (at < 0) return;
    const range = document.createRange();
    range.setStart(textNode, at); range.setEnd(textNode, end); range.deleteContents();
    const mentionItems = items === "all" ? [{ displayName: "所有人", userId: "all" }] : items;
    const fragment = document.createDocumentFragment(); let lastInserted: ChildNode | null = null;
    mentionItems.forEach((member) => { const chip = document.createElement("span"); chip.contentEditable = "false"; chip.dataset.mention = member.userId; chip.className = "chat-mention-token"; chip.textContent = `@${member.displayName}`; const spacer = document.createTextNode(""); fragment.append(chip, spacer); lastInserted = spacer; });
    range.insertNode(fragment);
    if (lastInserted) { const caret = document.createRange(); caret.setStartAfter(lastInserted); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret); }
    syncEditor(); setQuery(null);
  }

  function removePreviousMention(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Backspace") return;
    const selection = window.getSelection(); const editor = editorRef.current;
    if (!selection?.isCollapsed || !editor) return;
    const node = selection.anchorNode; const offset = selection.anchorOffset;
    let previous: ChildNode | null = null;
    if (node?.nodeType === Node.TEXT_NODE && offset === 0) previous = node.previousSibling;
    if (node === editor && offset > 0) previous = editor.childNodes[offset - 1];
    if (!(previous instanceof HTMLElement) || !previous.dataset.mention) return;
    event.preventDefault(); previous.remove(); syncEditor();
  }

  const showMenu = query !== null && filteredMembers.length > 0;
  return <div className="relative min-h-0 flex-1"><div ref={editorRef} contentEditable={!disabled} role="textbox" aria-label="消息内容" aria-multiline data-placeholder={placeholder} suppressContentEditableWarning onInput={syncEditor} onKeyDown={(event) => { removePreviousMention(event); if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} className="h-full min-h-0 w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--color-text-disabled)]" />{showMenu ? <div className="absolute bottom-2 left-2 z-20 w-64 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-floating)]"><div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]">群成员</div>{query === "" ? <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-control-soft-hover)]" onMouseDown={(event) => { event.preventDefault(); insertMentions("all"); }}><span className="chat-mention-token">@所有人</span></button> : filteredMembers.length > 1 ? <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-control-soft-hover)]" onMouseDown={(event) => { event.preventDefault(); insertMentions(filteredMembers); }}><span className="chat-mention-token">@以下成员</span><span className="text-xs text-[var(--color-text-secondary)]">{filteredMembers.length} 人</span></button> : null}<div className="max-h-48 overflow-y-auto">{filteredMembers.map((member) => <button key={member.userId} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-control-soft-hover)]" onMouseDown={(event) => { event.preventDefault(); insertMentions([member]); }}><Avatar name={member.displayName} imageUrl={member.avatarUrl} /><span className="truncate">{member.displayName}</span></button>)}</div></div> : null}</div>;
});

function MessageBubble({ message, mine, canRecall, senderName, senderAvatarUrl, onRecall, onReedit, onRetry }: { message: UiMessage; mine: boolean; canRecall: boolean; senderName: string; senderAvatarUrl?: string | null; onRecall: () => void; onReedit: () => void; onRetry: () => void }) {
  const recalled = message.status === "recalled";
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canOpenActions = mine && (canRecall || recalled || message.deliveryState === "failed");
  useEffect(() => {
    if (!menuPosition) return;
    const closeMenu = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuPosition(null); };
    const closeOnBlur = () => setMenuPosition(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeOnBlur);
    return () => { window.removeEventListener("pointerdown", closeMenu); window.removeEventListener("blur", closeOnBlur); };
  }, [menuPosition]);
  if (message.messageType === "system") return <div className="self-center rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">{message.content}</div>;
  const bubble = <div className={`w-fit max-w-full rounded-md border px-3 py-2 text-left ${mine ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--color-border)] bg-[var(--color-bg-subtle)]"}`}>{recalled ? <p className="text-sm italic text-[var(--color-text-secondary)]">消息已撤回</p> : <>{message.messageType === "email" ? <p className="mb-2 flex items-center gap-2 border-b border-[var(--color-border)] pb-2 text-sm font-semibold"><Envelope className="h-4 w-4" />{message.emailSubject}</p> : null}<p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">{message.content}</p>{message.attachments.map((attachment) => attachment.isImage ? <a key={attachment.fileId} href={`/api/files/${attachment.fileId}/download`} target="_blank" className="mt-2 block"><img src={`/api/files/${attachment.fileId}/download`} alt={attachment.name} className="max-h-64 max-w-full rounded-md object-contain" /><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{attachment.name} · {formatBytes(attachment.size)}</span></a> : <a key={attachment.fileId} href={`/api/files/${attachment.fileId}/download`} className="mt-2 flex items-center gap-2 text-sm text-[var(--color-primary)]"><Paperclip className="h-4 w-4" /><span>{attachment.name} · {formatBytes(attachment.size)}</span></a>)}</>}</div>;
  return <div className={`flex w-full items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}><div className={`shrink-0 ${mine ? "order-2" : ""}`}><Avatar name={senderName} imageUrl={senderAvatarUrl} /></div><div className={`w-[calc(100%-2.75rem)] min-w-0 ${mine ? "order-1 text-right" : ""}`}><div className={`mb-1 flex items-center gap-2 text-xs text-[var(--color-text-secondary)] ${mine ? "justify-end" : "justify-start"}`}>{mine ? <><time>{formatMessageTime(message.createdAt)}</time><span>{senderName}</span></> : <><span>{senderName}</span><time>{formatMessageTime(message.createdAt)}</time></>}</div><div className="relative inline-block max-w-[80%] text-left" onContextMenu={(event) => { if (!canOpenActions) return; event.preventDefault(); setMenuPosition({ left: Math.min(event.clientX, window.innerWidth - 128), top: Math.min(event.clientY, window.innerHeight - 96) }); }}>{bubble}</div></div>{menuPosition ? <div ref={menuRef} role="menu" className="fixed z-50 min-w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1 shadow-[var(--shadow-floating)]" style={{ left: menuPosition.left, top: menuPosition.top }} onContextMenu={(event) => event.preventDefault()}>{message.deliveryState === "failed" ? <button role="menuitem" className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--color-control-soft-hover)]" onClick={() => { setMenuPosition(null); onRetry(); }}>重新发送</button> : null}{recalled ? <button role="menuitem" className="block w-full rounded px-3 py-1.5 text-left text-sm text-[var(--color-primary)] hover:bg-[var(--color-control-soft-hover)]" onClick={() => { setMenuPosition(null); onReedit(); }}>重新编辑</button> : canRecall ? <button role="menuitem" className="block w-full rounded px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]" onClick={() => { setMenuPosition(null); onRecall(); }}>撤回</button> : null}</div> : null}</div>;
}

function NewConversationModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [users, setUsers] = useState<CommunicationUserResponse[]>([]); const [mode, setMode] = useState("direct"); const [selected, setSelected] = useState<string[]>([]); const [title, setTitle] = useState(""); const [userQuery, setUserQuery] = useState(""); const [error, setError] = useState(""); const [creating, setCreating] = useState(false);
  useEffect(() => { if (open) void listCommunicationUsers().then((result) => { const payload = result.data as { data?: CommunicationUserResponse[] | null } | undefined; setUsers(payload?.data ?? []); }); }, [open]);
  const normalizedUserQuery = userQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredUsers = users.filter((item) => !normalizedUserQuery || item.displayName.toLocaleLowerCase("zh-CN").includes(normalizedUserQuery));
  async function create() { setCreating(true); setError(""); try { const generatedTitle = users.filter((item) => selected.includes(item.id)).map((item) => item.displayName).join("、").slice(0, 160); const result = mode === "direct" ? await createDirectConversation({ body: { userId: selected[0] } }) : await createGroupConversation({ body: { title: title.trim() || generatedTitle || "新建群聊", memberIds: selected } }); const payload = result.data as { data?: CommunicationConversationResponse | null; message?: string } | undefined; if (!payload?.data) throw new Error(payload?.message ?? "创建失败"); onCreated(payload.data.id); setSelected([]); setTitle(""); } catch (cause) { setError(messageOf(cause)); } finally { setCreating(false); } }
  const close = () => { setUserQuery(""); onClose(); };
  return <Modal isOpen={open} onOpenChange={(value) => !creating && !value && close()}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!creating}><Modal.Container placement="center" size="md"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>新建会话</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={creating} /></Modal.Header><Modal.Body className="space-y-3"><Tabs selectedKey={mode} onSelectionChange={(key) => { setMode(String(key)); setSelected([]); setUserQuery(""); setError(""); }}><Tabs.List aria-label="会话类型"><Tabs.Tab id="direct">单聊<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="group">群聊<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs><div className={mode === "group" ? "grid grid-cols-2 gap-3" : ""}>{mode === "group" ? <label className="block min-w-0 text-sm font-medium text-[var(--color-text-primary)]">群聊名称<Input className="mt-2" fullWidth placeholder="按成员自动命名" value={title} disabled={creating} onChange={(event) => setTitle(event.currentTarget.value)} /></label> : null}<label className="block min-w-0 text-sm font-medium text-[var(--color-text-primary)]">搜索用户<Input className="mt-2" aria-label="搜索用户" fullWidth placeholder="输入用户名称" value={userQuery} disabled={creating} onChange={(event) => setUserQuery(event.currentTarget.value)} /></label></div><div className="max-h-72 space-y-1 overflow-y-auto">{filteredUsers.map((item) => <Checkbox key={item.id} isSelected={selected.includes(item.id)} isDisabled={creating} onChange={(checked) => setSelected(mode === "direct" ? (checked ? [item.id] : []) : checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} className="w-full rounded-md px-2 py-2 hover:bg-[var(--color-control-soft-hover)]"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{item.displayName}</Checkbox.Content></Checkbox>)}{filteredUsers.length === 0 ? <p className="px-2 py-6 text-center text-sm text-[var(--color-text-secondary)]">未找到匹配的用户</p> : null}</div>{error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}</Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={creating} onPress={close}>取消</Button><Button isDisabled={creating || selected.length === 0} onPress={() => void create()}>{creating ? "正在创建…" : "创建"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

function ManageGroupModal({ open, conversation, onClose, onSaved }: { open: boolean; conversation: CommunicationConversationResponse; onClose: () => void; onSaved: () => void }) {
  const [users, setUsers] = useState<CommunicationUserResponse[]>([]); const [title, setTitle] = useState(conversation.title); const [memberIds, setMemberIds] = useState<string[]>(conversation.members.map((member) => member.userId)); const [error, setError] = useState("");
  useEffect(() => { if (!open) return; const timer = window.setTimeout(() => { setTitle(conversation.title); setMemberIds(conversation.members.map((member) => member.userId)); void listCommunicationUsers().then((result) => { const payload = result.data as { data?: CommunicationUserResponse[] | null } | undefined; setUsers(payload?.data ?? []); }); }, 0); return () => window.clearTimeout(timer); }, [open, conversation]);
  async function save() { try { const original = new Set(conversation.members.map((member) => member.userId)); const next = new Set(memberIds); const result = await updateGroupConversation({ path: { conversationId: conversation.id }, body: { title, addMemberIds: [...next].filter((id) => !original.has(id)), removeMemberIds: [...original].filter((id) => !next.has(id)) } }); if (result.error) throw new Error("群聊更新失败"); onSaved(); } catch (cause) { setError(messageOf(cause)); } }
  return <Modal isOpen={open} onOpenChange={(value) => !value && onClose()}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="md"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>管理群聊</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><Modal.Body className="space-y-3"><Input fullWidth value={title} onChange={(event) => setTitle(event.currentTarget.value)} /><div className="max-h-72 space-y-1 overflow-y-auto">{[...conversation.members.map((member) => ({ id: member.userId, displayName: member.displayName })), ...users.filter((item) => !conversation.members.some((member) => member.userId === item.id))].map((item) => <Checkbox key={item.id} isSelected={memberIds.includes(item.id)} onChange={(checked) => setMemberIds((current) => checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} className="w-full rounded-md px-2 py-2"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{item.displayName}</Checkbox.Content></Checkbox>)}</div>{error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}</Modal.Body><Modal.Footer><Button variant="ghost" onPress={onClose}>取消</Button><Button isDisabled={!title.trim() || memberIds.length < 2} onPress={() => void save()}>保存</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

function ToolButton({ children, label, disabled, onPress }: { children: React.ReactNode; label: string; disabled: boolean; onPress: () => void }) { return <Tooltip><Tooltip.Trigger><Button isIconOnly variant="ghost" aria-label={label} isDisabled={disabled} onPress={onPress}>{children}</Button></Tooltip.Trigger><Tooltip.Content>{label}</Tooltip.Content></Tooltip>; }
function Avatar({ name, imageUrl }: { name: string; imageUrl?: string | null }) { return imageUrl ? <img src={imageUrl} alt={`${name}的头像`} className="h-9 w-9 shrink-0 rounded-md object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-sm font-semibold text-[var(--color-primary)]">{name.trim().slice(0, 1) || "?"}</span>; }
function Empty({ text }: { text: string }) { return <div className="flex h-full min-h-40 items-center justify-center text-center"><div><Comment className="mx-auto h-6 w-6 text-[var(--color-text-secondary)]" /><p className="mt-2 text-sm text-[var(--color-text-secondary)]">{text}</p></div></div>; }
function messageOf(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const candidate = value as { message?: unknown; error?: unknown; body?: { message?: unknown }; data?: { message?: unknown } };
    for (const message of [candidate.message, candidate.body?.message, candidate.data?.message, candidate.error]) {
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return "操作失败，请稍后重试";
}
function formatMessageTime(value: string) {
  const sentAt = new Date(value);
  const now = new Date();
  const time = sentAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const isSameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (isSameDay(sentAt, now)) return time;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (isSameDay(sentAt, yesterday)) return `昨天 ${time}`;
  const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  if (sentAt >= weekStart && sentAt.getFullYear() === now.getFullYear()) return `${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][sentAt.getDay()]} ${time}`;
  const date = `${sentAt.getMonth() + 1}月${sentAt.getDate()}日 ${time}`;
  return sentAt.getFullYear() === now.getFullYear() ? date : `${sentAt.getFullYear()}年${date}`;
}
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function previewMessage(message: CommunicationMessageResponse) { if (message.status === "recalled") return "消息已撤回"; if (message.messageType === "file") return `[文件] ${message.content}`; if (message.messageType === "email") return `[邮件] ${message.emailSubject ?? ""}`; return message.content.slice(0, 80); }
