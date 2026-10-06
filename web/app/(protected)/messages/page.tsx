"use client";
import { notify } from "@lib/notify";
/* eslint-disable @next/next/no-img-element -- authenticated attachment URLs cannot use the server-side image optimizer */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Popover,
  ScrollShadow,
  Tabs,
  TextArea,
  Tooltip,
} from "@heroui/react";
import {
  Envelope,
  FaceSmile,
  PaperPlane,
  Paperclip,
  Plus,
  TrashBin,
} from "@gravity-ui/icons";
import { useAuth } from "@components/AuthProvider";
import { MyAvatar } from "@components/my-fields/MyAvatar";
import { getCommunicationAvailability } from "@features/communication/api";
import { PageContentLayout } from "@components/PageContentLayout";
import { Empty } from "./components/Empty";
import { ToolButton } from "./components/ToolButton";
import { ConversationList } from "./components/ConversationList";
import { MessageDisplay } from "./components/MessageDisplay";
import { NewConversationModal as NewConversationDialog } from "./components/NewConversationModal";
import { ManageGroupModal as ManageGroupDialog } from "./components/ManageGroupModal";
import { MessageComposer } from "./components/MessageComposer";
import { useRouter } from "next/navigation";
import {
  createDirectConversation,
  createGroupConversation,
  listCommunicationConversations,
  listCommunicationUsers,
  markCommunicationConversationRead,
  recallCommunicationMessage,
  reeditCommunicationMessage,
  sendCommunicationMessage,
  updateGroupConversation,
  type CommunicationConversationResponse,
  type CommunicationMessageResponse,
  type CommunicationUserResponse,
  uploadCommunicationFile,
} from "@/features/communication/api";
import { approveWorkflowTask, rejectWorkflowTask } from "@/app/lib/api-client";
import {
  ImClientAdapter,
  type ImEnvelope,
} from "@features/communication/im-client";
import type { PendingImMessage } from "@features/communication/im-store";

const EMOJIS = [
  "😀",
  "😂",
  "😊",
  "😍",
  "👍",
  "👏",
  "🎉",
  "❤️",
  "🙏",
  "🤔",
  "😢",
  "🔥",
];
type ApiResult<T> = { data?: T; error?: unknown };
type UiMessage = CommunicationMessageResponse & {
  deliveryState?: "sending" | "failed" | "delivered";
};
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
  const router = useRouter();
  const { token, user } = useAuth();
  const [conversations, setConversations] = useState<
    CommunicationConversationResponse[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [nextBeforeSequence, setNextBeforeSequence] = useState<number | null>(
    null,
  );
  const [realtimeOnline, setRealtimeOnline] = useState(false);
  const [communicationAvailable, setCommunicationAvailable] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const adapterRef = useRef<ImClientAdapter | null>(null);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastNotifiedError = useRef("");
  const [newOpen, setNewOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [reediting, setReediting] =
    useState<CommunicationMessageResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerEditor = useRef<MentionComposerHandle>(null);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSentAt = useRef(0);
  const typingExpiryTimers = useRef(new Map<string, number>());
  const presenceExpiryTimers = useRef(new Map<string, number>());
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const systemSelected = selected?.conversationType === "system";

  useEffect(() => {
    if (!error) {
      lastNotifiedError.current = "";
      return;
    }
    if (lastNotifiedError.current === error) return;
    lastNotifiedError.current = error;
    notify.error("消息操作失败", { description: error });
  }, [error]);

  const loadConversations = useCallback(async () => {
    const result = (await listCommunicationConversations()) as ApiResult<{
      code: number;
      data: CommunicationConversationResponse[] | null;
      message: string;
    }>;
    if (result.error || !result.data?.data) {
      setCommunicationAvailable(false);
      throw new Error(
        result.data?.message ?? messageOf(result.error) ?? "无法加载会话",
      );
    }
    setCommunicationAvailable(true);
    setConversations(result.data.data);
    setSelectedId(
      (current) =>
        current ??
        result.data!.data!.find((item) => item.conversationType === "system")
          ?.id ??
        result.data!.data![0]?.id ??
        null,
    );
  }, []);

  const markConversationRead = useCallback(
    async (conversationId: string, sequence: number) => {
      await markCommunicationConversationRead({
        path: { conversationId },
        body: { sequence },
      });
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId ? { ...item, unreadCount: 0 } : item,
        ),
      );
      window.dispatchEvent(new Event("yaya-communication-read-updated"));
    },
    [],
  );

  const loadMessages = useCallback(
    async (conversationId: string, beforeSequence?: number) => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      if (beforeSequence === undefined) {
        const cached = await adapter.getCachedMessages(conversationId);
        const queued = (await adapter.getQueuedMessages()).filter((item) => item.conversationId === conversationId);
        if (selectedIdRef.current !== conversationId) return;
        setMessages((current) => mergeMessages(cached, current.filter((item) => item.conversationId === conversationId && item.deliveryState !== undefined), queued.map((item) => pendingMessage(item, user?.id ?? ""))));
        setNextBeforeSequence(cached[0]?.sequence ?? null);
      }
      if (beforeSequence === undefined && adapter.connectionState !== "online" && adapter.connectionState !== "syncing") return;
      const page = await adapter.requestHistory<CommunicationMessageResponse>(
        conversationId,
        beforeSequence,
        50,
      );
      if (selectedIdRef.current !== conversationId) return;
      setMessages((current) => mergeMessages(current, page.items));
      setNextBeforeSequence(page.hasMore === false ? null : page.nextBeforeConversationSeq ?? null);
      const sequence = page.items.at(-1)?.sequence;
      if (sequence) await markConversationRead(conversationId, sequence);
    },
    [markConversationRead, user?.id],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getCommunicationAvailability<{ enabled?: boolean }>()
        .then((status) => {
          if (!status.enabled) {
            setCommunicationAvailable(false);
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
    const timer = window.setTimeout(
      () =>
        void loadMessages(selectedId)
          .catch((cause) => setError(messageOf(cause))),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [selectedId, loadMessages, loadConversations]);

  useEffect(() => {
    if (!token || !user?.id) return;
    const configuredUrl = process.env.NEXT_PUBLIC_BACKEND_WS_URL?.trim();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const defaultPort =
      location.port === "8787"
        ? "8788"
        : location.port === "8801"
          ? "8802"
          : location.port;
    const url = configuredUrl
      ? location.protocol === "https:" && configuredUrl.startsWith("ws://")
        ? `wss://${configuredUrl.slice("ws://".length)}`
        : configuredUrl
      : `${protocol}//${location.hostname}${defaultPort ? `:${defaultPort}` : ""}/api/communication/ws`;
    const adapter = new ImClientAdapter({
      url,
      token,
      userId: user.id,
      deviceId: `web-${navigator.userAgent.slice(0, 48)}`,
      commandTransport: async (action, data) => {
        if (action !== "send") throw new Error("该命令通过专用 HTTP 接口提交");
        const input = data as {
          conversationId: string;
          messageType: string;
          content?: string;
          fileIds?: string[];
          emailSubject?: string;
          localId: string;
        };
        const result = await sendCommunicationMessage({
          path: { conversationId: input.conversationId },
          body: {
            messageType: input.messageType,
            content: input.content ?? "",
            fileIds: input.fileIds ?? [],
            emailSubject: input.emailSubject,
            localId: input.localId,
            clientMessageId: input.localId,
          },
        });
        if (result.error) throw result.error;
        return result.data?.data;
      },
    });
    adapterRef.current = adapter;
    void adapter.getCachedConversations().then((cached) => {
      if (adapterRef.current !== adapter || !cached.length) return;
      setConversations((current) => current.length ? current : cached);
      setSelectedId((current) => current ?? cached[0].id);
    }).catch((cause) => setError(messageOf(cause)));
    const refreshUserExpiry = (kind: "typing" | "presence", userId: string) => {
      const timers =
        kind === "typing"
          ? typingExpiryTimers.current
          : presenceExpiryTimers.current;
      const existing = timers.get(userId);
      if (existing) window.clearTimeout(existing);
      const timeout = window.setTimeout(
        () => {
          timers.delete(userId);
          if (kind === "typing")
            setTypingUsers((current) => current.filter((id) => id !== userId));
          else
            setOnlineUsers((current) => current.filter((id) => id !== userId));
        },
        kind === "typing" ? 2_000 : 45_000,
      );
      timers.set(userId, timeout);
    };
    const unsubscribe = adapter.subscribe((envelope: ImEnvelope) => {
      const eventType = envelope.event;
      const payload = (envelope.data ?? {}) as any;
      if (eventType === "connection.state") {
        setRealtimeOnline(payload.state === "online");
        if (payload.state === "reset_required") {
          setMessages([]);
          setNextBeforeSequence(null);
          setError("消息同步游标已过期，正在重新加载");
        }
        if (payload.state === "online" && selectedIdRef.current)
          void loadMessages(selectedIdRef.current).catch((cause) => setError(messageOf(cause)));
      }
      if (eventType === "storage.error") setError("本机聊天记录写入失败，请检查浏览器存储空间");
      if (eventType === "message.retry_pending" && envelope.localId)
        setMessages((current) => current.map((item) => item.localId === envelope.localId ? { ...item, deliveryState: "failed" } : item));
      if (
        eventType === "conversation.snapshot" &&
        Array.isArray(payload.items)
      ) {
        setConversations(payload.items);
        setSelectedId((current) => current ?? payload.items[0]?.id ?? null);
      }
      if (
        eventType === "conversation.typing" &&
        payload.userId &&
        payload.userId !== user?.id
      ) {
        setTypingUsers((current) =>
          payload.typing
            ? [...new Set([...current, payload.userId])]
            : current.filter((id) => id !== payload.userId),
        );
        if (payload.typing) refreshUserExpiry("typing", payload.userId);
      }
      if (
        eventType === "conversation.presence" &&
        payload.userId &&
        payload.userId !== user?.id
      ) {
        setOnlineUsers((current) => [...new Set([...current, payload.userId])]);
        refreshUserExpiry("presence", payload.userId);
      }
      if (
        eventType === "message.created" &&
        (payload.id || payload.messageId)
      ) {
        const messagePayload = {
          ...payload,
          id: payload.id ?? payload.messageId,
          conversationId: payload.conversationId ?? envelope.conversationId,
          sequence: payload.sequence ?? envelope.conversationSeq,
        } as CommunicationMessageResponse;
        const open = messagePayload.conversationId === selectedIdRef.current;
        if (open) {
          setMessages((current) => mergeMessages(current, [messagePayload]));
          if (messagePayload.sequence)
            void markConversationRead(
              messagePayload.conversationId!,
              messagePayload.sequence,
            ).catch((cause) => setError(messageOf(cause)));
        }
        setConversations((current) =>
          current.map((item) =>
            item.id === messagePayload.conversationId
              ? {
                  ...item,
                  lastMessageAt: messagePayload.createdAt,
                  lastMessageSequence: messagePayload.sequence,
                  lastMessagePreview: previewMessage(messagePayload),
                  unreadCount: open ? 0 : item.unreadCount,
                }
              : item,
          ),
        );
      }
      if (eventType === "message.recalled" && payload.id) {
        if (payload.conversationId === selectedIdRef.current)
          setMessages((current) => mergeMessages(current, [payload as CommunicationMessageResponse]));
        void loadConversations();
      }
    });
    void adapter.connect();
    const heartbeat = window.setInterval(() => {
      if (selectedIdRef.current)
        adapter.sendTransient("conversation.presence", {
          conversationId: selectedIdRef.current,
        });
    }, 20_000);
    return () => {
      window.clearInterval(heartbeat);
      unsubscribe();
      adapter.disconnect();
      adapterRef.current = null;
    };
  }, [
    token,
    user?.id,
    loadConversations,
    loadMessages,
    markConversationRead,
  ]);
  async function send(
    messageType: string,
    content: string,
    fileIds: string[] = [],
    subject?: string,
    retryLocalId?: string,
  ) {
    if (!selectedId || (!content.trim() && fileIds.length === 0)) return;
    const localId = retryLocalId ?? createClientMessageId();
    const temporaryId = `pending-${localId}`;
    if (!reediting)
      setMessages((current) => mergeMessages(current, [pendingMessage({ localId, conversationId: selectedId, messageType, content: content.trim(), fileIds, emailSubject: subject, createdAt: new Date().toISOString() }, user?.id ?? "")]));
    setBusy(true);
    setError("");
    try {
      if (reediting) {
        await reeditCommunicationMessage({
          path: { conversationId: selectedId, messageId: reediting.id },
          body: {
            content: content.trim(),
            fileIds,
            emailSubject: subject,
            clientMessageId: localId,
            localId,
          },
        });
        setReediting(null);
      } else {
        const adapter = adapterRef.current;
        if (!adapter) throw new Error("消息客户端尚未准备好，请稍后重试");
        if (messageType !== "text" && adapter.connectionState !== "online")
          throw new Error("当前离线，请连接后发送附件或邮件");
        await adapter.sendMessage({
          conversationId: selectedId,
          messageType,
          content: content.trim(),
          fileIds,
          emailSubject: subject,
          localId,
          createdAt: new Date().toISOString(),
        });
      }
      setComposer("");
      if (adapterRef.current?.connectionState === "online") void loadConversations().catch(() => undefined);
    } catch (cause) {
      setMessages((current) =>
        current.map((item) =>
          item.id === temporaryId ? { ...item, deliveryState: "failed" } : item,
        ),
      );
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      const payload = await uploadCommunicationFile(file);
      await send("file", file.name, [payload.fileId]);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function recall(message: CommunicationMessageResponse) {
    if (!selectedId) return;
    try {
      await recallCommunicationMessage({
        path: { conversationId: selectedId, messageId: message.id },
        body: {},
      });
      await loadMessages(selectedId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  function beginReedit(message: CommunicationMessageResponse) {
    setReediting(message);
    setComposer(message.content);
    setEmailSubject(message.emailSubject ?? "");
  }

  function updateComposer(value: string) {
    setComposer(value);
    if (!selectedId) return;
    const now = Date.now();
    if (value && now - lastTypingSentAt.current >= 500) {
      adapterRef.current?.sendTransient("conversation.typing", {
        conversationId: selectedId,
        typing: true,
      });
      lastTypingSentAt.current = now;
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(
      () =>
        adapterRef.current?.sendTransient("conversation.typing", {
          conversationId: selectedId,
          typing: false,
        }),
      1500,
    );
  }

  return (
    <PageContentLayout
      title="消息"
      subtitle={`${conversations.length} 个会话`}
      actions={
        <div className="flex items-center gap-2"><Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              aria-label="新建会话"
              isDisabled={!communicationAvailable}
              onPress={() => setNewOpen(true)}
            >
              <Plus />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>新建会话</Tooltip.Content>
        </Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly aria-label="清除本机聊天记录" onPress={() => setClearCacheOpen(true)}><TrashBin /></Button></Tooltip.Trigger><Tooltip.Content>清除本机聊天记录</Tooltip.Content></Tooltip></div>
      }
    >
      <main className="h-full min-h-0">
        <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-3 overflow-hidden max-[1023px]:grid-cols-1 max-[1023px]:grid-rows-[minmax(12rem,32%)_minmax(0,1fr)]">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            currentUserId={user?.id}
            onSelect={setSelectedId}
            formatTime={formatConversationTime}
          />
          <Card className="flex min-h-0 flex-col">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5">
              <div>
                <h2 className="text-sm font-semibold">
                  {systemSelected
                    ? "系统通知"
                    : (selected?.title ?? "选择会话")}
                </h2>
                <p className="m-0 text-xs text-[var(--color-text-secondary)]">
                  {systemSelected
                    ? "流程待办、抄送和系统提醒"
                    : typingUsers.length
                      ? "对方正在输入…"
                      : selected
                        ? `${realtimeOnline ? "实时连接正常" : "正在重连"}${onlineUsers.length ? ` · ${onlineUsers.length} 人在线` : ""} · ${selected!.members.map((member) => member.displayName).join("、")}`
                        : "从左侧选择一条会话"}
                </p>
              </div>
              {selected?.conversationType === "group" &&
              selected!.members.some(
                (member) =>
                  member.userId === user?.id && member.role === "owner",
              ) ? (
                <Button onPress={() => setManageOpen(true)}>管理群聊</Button>
              ) : null}
            </header>
            <MessageDisplay
              conversation={selected}
              messages={messages}
              currentUserId={user?.id}
              currentUserName={user?.displayName}
              currentTime={currentTime}
              nextBeforeSequence={nextBeforeSequence}
              onLoadEarlier={() => selectedId && void loadMessages(selectedId, nextBeforeSequence ?? undefined)}
              onRecall={(message) => void recall(message)}
              onReedit={beginReedit}
              onRetry={(message) => {
                void (async () => {
                  const adapter = adapterRef.current;
                  const queued = adapter && message.localId && (await adapter.getQueuedMessages()).some((item) => item.localId === message.localId);
                  if (queued) {
                    adapter.retryPending();
                    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, deliveryState: "sending" } : item));
                  } else {
                    await send(message.messageType, message.content, message.fileIds, message.emailSubject ?? undefined, message.localId ?? undefined);
                  }
                })().catch((cause) => setError(messageOf(cause)));
              }}
              onApprovalAction={async (message, action) => {
                const payload = (message.payload ?? {}) as { taskUuid?: string; businessId?: string; cardType?: string; version?: number };
                const taskUuid = payload.taskUuid ?? payload.businessId;
                if (payload.cardType !== "approval" || !taskUuid) return;
                const request = action === "approve" ? approveWorkflowTask : rejectWorkflowTask;
                const result = await request({ path: { taskUuid }, body: { comment: undefined, cardVersion: payload.version, messageId: message.id } });
                if (result.error) throw result.error;
              }}
            />
            {!systemSelected ? (
              <MessageComposer>
                {reediting ? (
                  <div className="mb-2 flex items-center justify-between rounded-md bg-[var(--color-primary-soft)] px-3 py-2 text-xs text-[var(--color-primary)]">
                    <span>正在重新编辑撤回的消息</span>
                    <Button
                      onPress={() => {
                        setReediting(null);
                        setComposer("");
                      }}
                    >
                      取消
                    </Button>
                  </div>
                ) : null}
                <div className="flex h-40 min-h-32 flex-col overflow-visible rounded-md border border-[var(--color-border)] bg-[var(--color-bg-input)]">
                  <MentionComposer
                    ref={composerEditor}
                    value={composer}
                    members={
                      selected?.conversationType === "group"
                        ? selected!.members
                        : []
                    }
                    disabled={!selected}
                    placeholder={selected ? "输入消息" : "选择会话后输入消息"}
                    onChange={updateComposer}
                    onSend={() =>
                      void send(
                        reediting?.messageType ?? "text",
                        composer,
                        reediting?.fileIds ?? [],
                        reediting?.emailSubject ?? undefined,
                      )
                    }
                  />
                  <div className="flex h-10 shrink-0 items-center justify-between px-2">
                    <div className="flex gap-1">
                      <Popover>
                        <Popover.Trigger>
                          <Button
                            isIconOnly
                            aria-label="发送表情"
                            isDisabled={!selected}
                          >
                            <FaceSmile />
                          </Button>
                        </Popover.Trigger>
                        <Popover.Content>
                          <Popover.Dialog aria-label="选择表情">
                            {EMOJIS.map((emoji) => (
                              <Button
                                key={emoji}
                                isIconOnly
                                onPress={() =>
                                  composerEditor.current?.insertText(emoji)
                                }
                              >
                                {emoji}
                              </Button>
                            ))}
                          </Popover.Dialog>
                        </Popover.Content>
                      </Popover>
                      <ToolButton
                        label="发送文件"
                        disabled={!selected || busy}
                        onPress={() => fileInput.current?.click()}
                      >
                        <Paperclip />
                      </ToolButton>
                      <ToolButton
                        label="发送邮件"
                        disabled={!selected || busy}
                        onPress={() => setEmailOpen(true)}
                      >
                        <Envelope />
                      </ToolButton>
                      <input
                        ref={fileInput}
                        type="file"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void upload(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                    <Tooltip>
                      <Tooltip.Trigger>
                        <Button
                          isIconOnly
                          aria-label="发送消息"
                          isDisabled={!selected || !composer.trim() || busy}
                          onPress={() =>
                            void send(
                              reediting?.messageType ?? "text",
                              composer,
                              reediting?.fileIds ?? [],
                              reediting?.emailSubject ?? undefined,
                            )
                          }
                        >
                          <PaperPlane />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>发送消息</Tooltip.Content>
                    </Tooltip>
                  </div>
                </div>
              </MessageComposer>
            ) : null}
          </Card>
        </div>
        <NewConversationDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          messageOf={messageOf}
          onCreated={(id) => {
            setNewOpen(false);
            void loadConversations().then(() => setSelectedId(id));
          }}
        />
        {selected ? (
          <ManageGroupDialog
            open={manageOpen}
            conversation={selected!}
            onClose={() => setManageOpen(false)}
            messageOf={messageOf}
            onSaved={() => {
              setManageOpen(false);
              void loadConversations();
            }}
          />
        ) : null}
        <Modal isOpen={clearCacheOpen} onOpenChange={setClearCacheOpen}>
          <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
            <Modal.Container placement="center" size="sm"><Modal.Dialog>
              <Modal.Header><Modal.Heading>清除本机聊天记录</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header>
              <Modal.Body>仅清除当前账号在本机缓存的会话、消息及待发送内容。服务器记录不会删除。</Modal.Body>
              <Modal.Footer><Button onPress={() => setClearCacheOpen(false)}>取消</Button><Button onPress={() => void adapterRef.current?.clearLocalHistory().then(() => { setMessages([]); setConversations([]); setClearCacheOpen(false); }).catch((cause) => setError(messageOf(cause)))}>清除</Button></Modal.Footer>
            </Modal.Dialog></Modal.Container>
          </Modal.Backdrop>
        </Modal>
        <Modal isOpen={emailOpen} onOpenChange={setEmailOpen}>
          <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
            <Modal.Container placement="center" size="md">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>发送邮件消息</Modal.Heading>
                  <Modal.CloseTrigger aria-label="关闭" />
                </Modal.Header>
                <Modal.Body>
                  <Input
                    autoFocus
                    fullWidth
                    placeholder="邮件主题"
                    value={emailSubject}
                    onChange={(event) =>
                      setEmailSubject(event.currentTarget.value)
                    }
                  />
                  <TextArea
                    fullWidth
                    placeholder="邮件正文"
                    value={emailBody}
                    onChange={(event) =>
                      setEmailBody(event.currentTarget.value)
                    }
                  />
                </Modal.Body>
                <Modal.Footer>
                  <Button onPress={() => setEmailOpen(false)}>取消</Button>
                  <Button
                    isDisabled={!emailSubject.trim() || !emailBody.trim()}
                    onPress={() => {
                      void send("email", emailBody, [], emailSubject);
                      setEmailOpen(false);
                      setEmailBody("");
                      setEmailSubject("");
                    }}
                  >
                    发送
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </main>
    </PageContentLayout>
  );
}

const MentionComposer = forwardRef<
  MentionComposerHandle,
  {
    value: string;
    members: CommunicationConversationResponse["members"];
    disabled: boolean;
    placeholder: string;
    onChange: (value: string) => void;
    onSend: () => void;
  }
>(function MentionComposer(
  { value, members, disabled, placeholder, onChange, onSend },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const emittedValue = useRef("");
  const [query, setQuery] = useState<string | null>(null);
  const filteredMembers =
    query === null
      ? []
      : members.filter((member) =>
          member.displayName
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        );

  useEffect(() => {
    if (value === emittedValue.current || !editorRef.current) return;
    editorRef.current.textContent = value;
    emittedValue.current = value;
    setQuery(null);
  }, [value]);
  useImperativeHandle(ref, () => ({
    insertText(text) {
      editorRef.current?.focus();
      document.execCommand("insertText", false, text);
      syncEditor();
    },
  }));

  function syncEditor() {
    const nextValue = editorRef.current?.textContent ?? "";
    emittedValue.current = nextValue;
    onChange(nextValue);
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || !editorRef.current?.contains(node)) return setQuery(null);
    const text =
      node.nodeType === Node.TEXT_NODE
        ? (node.textContent?.slice(0, selection?.anchorOffset ?? 0) ?? "")
        : "";
    const atIndex = text.lastIndexOf("@");
    const nextQuery =
      atIndex >= 0 && !/\s/.test(text.slice(atIndex + 1))
        ? text.slice(atIndex + 1)
        : null;
    setQuery(
      nextQuery !== null &&
        members.some((member) =>
          member.displayName
            .toLocaleLowerCase()
            .includes(nextQuery.toLocaleLowerCase()),
        )
        ? nextQuery
        : null,
    );
  }

  function insertMentions(
    items: CommunicationConversationResponse["members"] | "all",
  ) {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!editor || !selection || !node || node.nodeType !== Node.TEXT_NODE)
      return;
    const textNode = node as Text;
    const end = selection.anchorOffset;
    const at = textNode.data.lastIndexOf("@", end);
    if (at < 0) return;
    const range = document.createRange();
    range.setStart(textNode, at);
    range.setEnd(textNode, end);
    range.deleteContents();
    const mentionItems =
      items === "all" ? [{ displayName: "所有人", userId: "all" }] : items;
    const fragment = document.createDocumentFragment();
    let lastInserted: ChildNode | null = null;
    mentionItems.forEach((member) => {
      const chip = document.createElement("span");
      chip.contentEditable = "false";
      chip.dataset.mention = member.userId;
      chip.className = "mx-0.5 inline-block select-none rounded-[3px] bg-[var(--color-primary-soft)] px-1 py-px text-[var(--color-primary)] leading-[1.4]";
      chip.textContent = `@${member.displayName}`;
      const spacer = document.createTextNode("");
      fragment.append(chip, spacer);
      lastInserted = spacer;
    });
    range.insertNode(fragment);
    if (lastInserted) {
      const caret = document.createRange();
      caret.setStartAfter(lastInserted);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    syncEditor();
    setQuery(null);
  }

  function removePreviousMention(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Backspace") return;
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!selection?.isCollapsed || !editor) return;
    const node = selection.anchorNode;
    const offset = selection.anchorOffset;
    let previous: ChildNode | null = null;
    if (node?.nodeType === Node.TEXT_NODE && offset === 0)
      previous = node.previousSibling;
    if (node === editor && offset > 0) previous = editor.childNodes[offset - 1];
    if (!(previous instanceof HTMLElement) || !previous.dataset.mention) return;
    event.preventDefault();
    previous.remove();
    syncEditor();
  }

  const showMenu = query !== null && filteredMembers.length > 0;
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={editorRef}
        contentEditable={!disabled}
        role="textbox"
        aria-label="消息内容"
        aria-multiline
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={syncEditor}
        onKeyDown={(event) => {
          removePreviousMention(event);
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
        className="min-h-0 w-full flex-1 resize-none overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-3 py-2 text-[var(--color-text-primary)] outline-none"
      />
      {showMenu ? (
        <div className="absolute bottom-2 left-2 z-20 w-64 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-floating)]">
          <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]">
            群成员
          </div>
          {query === "" ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-start text-[var(--color-text-primary)] hover:bg-[var(--color-control-soft-hover)]"
              onMouseDown={(event) => {
                event.preventDefault();
                insertMentions("all");
              }}
            >
              @所有人
            </button>
          ) : filteredMembers.length > 1 ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-start text-[var(--color-text-primary)] hover:bg-[var(--color-control-soft-hover)]"
              onMouseDown={(event) => {
                event.preventDefault();
                insertMentions(filteredMembers);
              }}
            >
              @以下成员{" "}
              <span className="m-0 text-xs text-[var(--color-text-secondary)]">
                {filteredMembers.length} 人
              </span>
            </button>
          ) : null}
          <div className="max-h-48 overflow-y-auto">
            {filteredMembers.map((member) => (
              <button
                key={member.userId}
                type="button"
                className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-start text-[var(--color-text-primary)] hover:bg-[var(--color-control-soft-hover)]"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMentions([member]);
                }}
              >
                <MyAvatar
                  name={member.displayName}
                  imageUrl={member.avatarUrl}
                />
                <span>{member.displayName}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

function MessageBubble({
  message,
  mine,
  canRecall,
  senderName,
  senderAvatarUrl,
  onRecall,
  onReedit,
  onRetry,
  onApprovalAction,
}: {
  message: UiMessage;
  mine: boolean;
  canRecall: boolean;
  senderName: string;
  senderAvatarUrl?: string | null;
  onRecall: () => void;
  onReedit: () => void;
  onRetry: () => void;
  onApprovalAction: (action: "approve" | "reject") => Promise<void>;
}) {
  const recalled = message.status === "recalled";
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canOpenActions =
    mine && (canRecall || recalled || message.deliveryState === "failed");
  useEffect(() => {
    if (!menuPosition) return;
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node))
        setMenuPosition(null);
    };
    const closeOnBlur = () => setMenuPosition(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [menuPosition]);
  if (message.messageType === "system") {
    const card = (message.payload ?? {}) as {
      cardType?: string;
      title?: string;
      content?: string;
      actions?: Array<{ id?: string; label?: string }>;
    };
    return (
      <div className="self-center rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
        {card.title ? <strong className="block">{card.title}</strong> : null}
        <span>{card.content ?? message.content}</span>
        {card.cardType === "approval" && card.actions?.length ? (
          <div className="mt-2 flex gap-2">
            {card.actions
              .filter(
                (action) => action.id === "approve" || action.id === "reject",
              )
              .map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  onPress={() =>
                    void onApprovalAction(action.id as "approve" | "reject")
                  }
                >
                  {action.label ?? action.id}
                </Button>
              ))}
          </div>
        ) : null}
      </div>
    );
  }
  const bubble = (
    <div
      className={`relative inline-block max-w-[80%] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-start ${mine ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : ""}`}
    >
      {recalled ? (
        <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">消息已撤回</p>
      ) : (
        <>
          {message.messageType === "email" ? (
            <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">
              <Envelope />
              {message.emailSubject}
            </p>
          ) : null}
          <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">{message.content}</p>
          {message.attachments.map((attachment) =>
            attachment.isImage ? (
              <a
                key={attachment.fileId}
                href={`/api/files/${attachment.fileId}/download`}
                target="_blank"
                className="mt-2 block text-sm text-[var(--color-primary)]"
              >
                <img
                  src={`/api/files/${attachment.fileId}/download`}
                  alt={attachment.name}
                  className="block max-h-64 max-w-full object-contain"
                />
                <span>
                  {attachment.name} · {formatBytes(attachment.size)}
                </span>
              </a>
            ) : (
              <a
                key={attachment.fileId}
                href={`/api/files/${attachment.fileId}/download`}
                className="mt-2 block text-sm text-[var(--color-primary)]"
              >
                <Paperclip />
                {attachment.name} · {formatBytes(attachment.size)}
              </a>
            ),
          )}
        </>
      )}
    </div>
  );
  return (
    <div
      className={`flex w-full items-start gap-2 ${mine ? "justify-end" : ""}`}
    >
      <div className={mine ? "order-2" : ""}>
        <MyAvatar name={senderName} imageUrl={senderAvatarUrl} />
      </div>
      <div
        className={`min-w-0 w-[calc(100%-2.75rem)] ${mine ? "order-1 text-end" : ""}`}
      >
        <div
          className={`mb-1 flex items-center gap-2 text-xs text-[var(--color-text-secondary)] ${mine ? "justify-end" : ""}`}
        >
          {mine ? (
            <>
              <time>{formatMessageTime(message.createdAt)}</time>
              <span>{senderName}</span>
            </>
          ) : (
            <>
              <span>{senderName}</span>
              <time>{formatMessageTime(message.createdAt)}</time>
            </>
          )}
        </div>
        <div
          onContextMenu={(event) => {
            if (!canOpenActions) return;
            event.preventDefault();
            setMenuPosition({
              left: Math.min(event.clientX, window.innerWidth - 128),
              top: Math.min(event.clientY, window.innerHeight - 96),
            });
          }}
        >
          {bubble}
        </div>
      </div>
      {menuPosition ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 flex flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1 shadow-[var(--shadow-floating)]"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {message.deliveryState === "failed" ? (
            <Button
              onPress={() => {
                setMenuPosition(null);
                onRetry();
              }}
            >
              重新发送
            </Button>
          ) : null}
          {recalled ? (
            <Button
              onPress={() => {
                setMenuPosition(null);
                onReedit();
              }}
            >
              重新编辑
            </Button>
          ) : canRecall ? (
            <Button
              onPress={() => {
                setMenuPosition(null);
                onRecall();
              }}
            >
              撤回
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NewConversationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [users, setUsers] = useState<CommunicationUserResponse[]>([]);
  const [mode, setMode] = useState("direct");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (open)
      void listCommunicationUsers().then((result) => {
        const payload = result.data as
          | { data?: CommunicationUserResponse[] | null }
          | undefined;
        setUsers(payload?.data ?? []);
      });
  }, [open]);
  const normalizedUserQuery = userQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredUsers = users.filter(
    (item) =>
      !normalizedUserQuery ||
      item.displayName.toLocaleLowerCase("zh-CN").includes(normalizedUserQuery),
  );
  async function create() {
    setCreating(true);
    setError("");
    try {
      const generatedTitle = users
        .filter((item) => selected.includes(item.id))
        .map((item) => item.displayName)
        .join("、")
        .slice(0, 160);
      const result =
        mode === "direct"
          ? await createDirectConversation({ body: { userId: selected[0] } })
          : await createGroupConversation({
              body: {
                title: title.trim() || generatedTitle || "新建群聊",
                memberIds: selected,
              },
            });
      const payload = result.data as
        | { data?: CommunicationConversationResponse | null; message?: string }
        | undefined;
      if (!payload?.data) throw new Error(payload?.message ?? "创建失败");
      onCreated(payload.data.id);
      setSelected([]);
      setTitle("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setCreating(false);
    }
  }
  const close = () => {
    setUserQuery("");
    onClose();
  };
  return (
    <Modal
      isOpen={open}
      onOpenChange={(value) => !creating && !value && close()}
    >
      <Modal.Backdrop
        className="theme-modal-backdrop"
        isDismissable={!creating}
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>新建会话</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" isDisabled={creating} />
            </Modal.Header>
            <Modal.Body>
              <Tabs
                selectedKey={mode}
                onSelectionChange={(key) => {
                  setMode(String(key));
                  setSelected([]);
                  setUserQuery("");
                  setError("");
                }}
              >
                <Tabs.List aria-label="会话类型">
                  <Tabs.Tab id="direct">
                    单聊
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="group">
                    群聊
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs>
              <div className={mode === "group" ? "grid grid-cols-2 gap-3" : ""}>
                {mode === "group" ? (
                  <label className="block min-w-0 text-sm font-medium text-[var(--color-text-primary)]">
                    群聊名称
                    <Input
                      className="mt-2"
                      fullWidth
                      placeholder="按成员自动命名"
                      value={title}
                      disabled={creating}
                      onChange={(event) => setTitle(event.currentTarget.value)}
                    />
                  </label>
                ) : null}
                <label className="block min-w-0 text-sm font-medium text-[var(--color-text-primary)]">
                  搜索用户
                  <Input
                    className="mt-2"
                    aria-label="搜索用户"
                    fullWidth
                    placeholder="输入用户名称"
                    value={userQuery}
                    disabled={creating}
                    onChange={(event) =>
                      setUserQuery(event.currentTarget.value)
                    }
                  />
                </label>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {filteredUsers.map((item) => (
                  <Checkbox
                    key={item.id}
                    isSelected={selected.includes(item.id)}
                    isDisabled={creating}
                    onChange={(checked) =>
                      setSelected(
                        mode === "direct"
                          ? checked
                            ? [item.id]
                            : []
                          : checked
                            ? [...selected, item.id]
                            : selected.filter((id) => id !== item.id),
                      )
                    }
                    className="w-full rounded-md px-2 py-2 hover:bg-[var(--color-control-soft-hover)]"
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      {item.displayName}
                    </Checkbox.Content>
                  </Checkbox>
                ))}
                {filteredUsers.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-[var(--color-text-secondary)]">
                    未找到匹配的用户
                  </p>
                ) : null}
              </div>
              {error ? (
                <p className="text-xs text-[var(--color-danger)]">{error}</p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button isDisabled={creating} onPress={close}>
                取消
              </Button>
              <Button
                isDisabled={creating || selected.length === 0}
                onPress={() => void create()}
              >
                {creating ? "正在创建…" : "创建"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ManageGroupModal({
  open,
  conversation,
  onClose,
  onSaved,
}: {
  open: boolean;
  conversation: CommunicationConversationResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [users, setUsers] = useState<CommunicationUserResponse[]>([]);
  const [title, setTitle] = useState(conversation.title);
  const [memberIds, setMemberIds] = useState<string[]>(
    conversation.members.map((member) => member.userId),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setTitle(conversation.title);
      setMemberIds(conversation.members.map((member) => member.userId));
      void listCommunicationUsers().then((result) => {
        const payload = result.data as
          | { data?: CommunicationUserResponse[] | null }
          | undefined;
        setUsers(payload?.data ?? []);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, conversation]);
  async function save() {
    try {
      const original = new Set(
        conversation.members.map((member) => member.userId),
      );
      const next = new Set(memberIds);
      const result = await updateGroupConversation({
        path: { conversationId: conversation.id },
        body: {
          title,
          addMemberIds: [...next].filter((id) => !original.has(id)),
          removeMemberIds: [...original].filter((id) => !next.has(id)),
        },
      });
      if (result.error) throw new Error("群聊更新失败");
      onSaved();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }
  return (
    <Modal isOpen={open} onOpenChange={(value) => !value && onClose()}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>管理群聊</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <Input
                fullWidth
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {[
                  ...conversation.members.map((member) => ({
                    id: member.userId,
                    displayName: member.displayName,
                  })),
                  ...users.filter(
                    (item) =>
                      !conversation.members.some(
                        (member) => member.userId === item.id,
                      ),
                  ),
                ].map((item) => (
                  <Checkbox
                    key={item.id}
                    isSelected={memberIds.includes(item.id)}
                    onChange={(checked) =>
                      setMemberIds((current) =>
                        checked
                          ? [...new Set([...current, item.id])]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                    className="w-full rounded-md px-2 py-2"
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      {item.displayName}
                    </Checkbox.Content>
                  </Checkbox>
                ))}
              </div>
              {error ? (
                <p className="text-xs text-[var(--color-danger)]">{error}</p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={onClose}>取消</Button>
              <Button
                isDisabled={!title.trim() || memberIds.length < 2}
                onPress={() => void save()}
              >
                保存
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function messageOf(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const candidate = value as {
      message?: unknown;
      error?: unknown;
      body?: { message?: unknown };
      data?: { message?: unknown };
    };
    for (const message of [
      candidate.message,
      candidate.body?.message,
      candidate.data?.message,
      candidate.error,
    ]) {
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return "操作失败，请稍后重试";
}

function pendingMessage(item: PendingImMessage, userId: string): UiMessage {
  return {
    id: `pending-${item.localId}`,
    conversationId: item.conversationId,
    senderUserId: userId,
    sequence: Number.MAX_SAFE_INTEGER,
    messageType: item.messageType,
    content: item.content,
    emailSubject: item.emailSubject,
    fileIds: item.fileIds,
    attachments: [],
    payload: {},
    status: "active",
    createdAt: item.createdAt,
    deliveryState: "sending",
    localId: item.localId,
  };
}

function mergeMessages(...groups: UiMessage[][]): UiMessage[] {
  const result = new Map<string, UiMessage>();
  for (const item of groups.flat()) {
    if (item.localId) result.delete(`local-${item.localId}`);
    if (!item.id.startsWith("pending-") && item.localId) result.delete(`pending-${item.localId}`);
    result.set(item.id.startsWith("pending-") ? `pending-${item.localId}` : item.id, item);
  }
  const deliveredLocalIds = new Set([...result.values()].filter((item) => !item.id.startsWith("pending-")).map((item) => item.localId));
  return [...result.values()]
    .filter((item) => !item.id.startsWith("pending-") || !deliveredLocalIds.has(item.localId))
    .sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt));
}
function formatMessageTime(value: string) {
  const sentAt = new Date(value);
  const now = new Date();
  const time = sentAt.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const isSameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (isSameDay(sentAt, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(sentAt, yesterday)) return `昨天 ${time}`;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  if (sentAt >= weekStart && sentAt.getFullYear() === now.getFullYear())
    return `${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][sentAt.getDay()]} ${time}`;
  const date = `${sentAt.getMonth() + 1}月${sentAt.getDate()}日 ${time}`;
  return sentAt.getFullYear() === now.getFullYear()
    ? date
    : `${sentAt.getFullYear()}年${date}`;
}
function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay)
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function previewMessage(message: CommunicationMessageResponse) {
  if (message.status === "recalled") return "消息已撤回";
  if (message.messageType === "file") return `[文件] ${message.content}`;
  if (message.messageType === "email")
    return `[邮件] ${message.emailSubject ?? ""}`;
  return message.content.slice(0, 80);
}
