import type { CommunicationConversationResponse, CommunicationMessageResponse } from "./api";
import { ImStore, type PendingImMessage } from "./im-store";

export type ImConnectionState = "idle" | "connecting" | "syncing" | "online" | "reconnecting" | "reset_required" | "failed";
export type ImEnvelope<T = unknown> = { type: "event" | "request" | "response"; event?: string; action?: string; requestId?: string | null; mailboxSeq?: number; conversationSeq?: number; conversationId?: string; localId?: string; data?: T; ok?: boolean };
export type ImHistoryPage<T = unknown> = { conversationId: string; items: T[]; nextBeforeConversationSeq?: number | null; hasMore?: boolean };
export type ImClientListener = (envelope: ImEnvelope) => void;

export function createImRequest<T>(action: string, data: T, requestId: string): ImEnvelope<T> { return { type: "request", action, requestId, data }; }
export function isImEvent(value: unknown): value is ImEnvelope { return !!value && typeof value === "object" && (value as ImEnvelope).type === "event"; }
export function mergeMailboxEvents<T extends { id?: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) if (item.id) byId.set(item.id, item);
  return [...byId.values()];
}

type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number };
type ImOptions = { url: string; token: string; userId: string; deviceId?: string; commandTransport: (action: string, data: unknown, requestId: string) => Promise<unknown> };

export class ImClientAdapter {
  private socket: WebSocket | null = null;
  private listeners = new Set<ImClientListener>();
  private pending = new Map<string, PendingRequest>();
  private historyInFlight = new Map<string, { key: string; promise: Promise<ImHistoryPage<CommunicationMessageResponse>> }>();
  private buffered = new Map<number, ImEnvelope>();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;
  private cursor = 0;
  private state: ImConnectionState = "idle";
  private processing = Promise.resolve();
  private syncRequested = false;
  private snapshotComplete = false;
  private snapshotTarget = 0;
  private sending = new Set<string>();
  private connectionGeneration = 0;
  readonly store: ImStore;

  constructor(private readonly options: ImOptions) { this.store = new ImStore(`${new URL(options.url).origin}:${options.userId}`); }
  get connectionState() { return this.state; }
  get mailboxSeq() { return this.cursor; }
  async getCachedConversations() { return this.store.getConversations(); }
  async getCachedMessages(conversationId: string, beforeSequence?: number) { return this.store.getMessages(conversationId, beforeSequence); }
  async getQueuedMessages() { return this.store.getPending(); }
  async clearLocalHistory() {
    await this.store.clear(); this.cursor = 0; this.buffered.clear(); this.snapshotComplete = false;
    if (this.socket?.readyState === WebSocket.OPEN) this.sendRaw("sync", { deviceId: this.options.deviceId ?? "web", lastMailboxSeq: 0 });
  }

  async connect() {
    if (typeof window === "undefined" || this.socket || this.state === "connecting") return;
    const generation = ++this.connectionGeneration;
    try { this.cursor = await this.store.getCursor(); }
    catch (error) { this.setState("failed"); this.emit({ type: "event", event: "storage.error", data: error }); return; }
    if (this.socket || generation !== this.connectionGeneration) return;
    this.setState(this.reconnectAttempt ? "reconnecting" : "connecting");
    const socket = new WebSocket(this.options.url, ["yaya-chat", this.options.token]);
    this.socket = socket;
    socket.onopen = () => {
      this.setState("syncing"); this.snapshotComplete = false; this.snapshotTarget = this.cursor; this.syncRequested = false;
      this.sendRaw("sync", { deviceId: this.options.deviceId ?? "web", lastMailboxSeq: this.cursor });
      this.heartbeatTimer = window.setInterval(() => { try { this.sendRaw("ping", {}); } catch { /* reconnect handles this */ } }, 20_000);
    };
    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(String(event.data)) as ImEnvelope;
        this.processing = this.processing.then(() => this.handleEnvelope(envelope)).catch((error) => {
          this.setState("failed"); this.emit({ type: "event", event: "storage.error", data: error }); socket.close();
        });
      } catch { this.emit({ type: "event", event: "protocol.error", data: { reason: "malformed_json" } }); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      for (const [id, request] of this.pending) { window.clearTimeout(request.timer); request.reject(new Error("IM 连接已关闭")); this.pending.delete(id); }
      if (this.state !== "idle") this.scheduleReconnect();
    };
  }
  disconnect() {
    this.connectionGeneration++;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.reconnectTimer = this.heartbeatTimer = null; this.setState("idle"); this.socket?.close(); this.socket = null;
  }
  subscribe(listener: ImClientListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  sendCommand<T>(action: string, data: T): Promise<unknown> {
    const requestId = crypto.randomUUID();
    if (["send", "approve", "reject"].includes(action)) return this.options.commandTransport(action, data, requestId);
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(requestId); reject(new Error("IM 请求超时")); }, 12_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.sendRaw(action, data, requestId); }
      catch (error) { window.clearTimeout(timer); this.pending.delete(requestId); reject(error as Error); }
    });
  }
  async sendMessage(input: PendingImMessage) {
    await this.store.putPending(input);
    this.emit({ type: "event", event: "message.queued", localId: input.localId, conversationId: input.conversationId, data: input });
    if (this.state === "online") void this.flushPending();
    return { localId: input.localId, accepted: true };
  }
  retryPending() { if (this.state === "online") void this.flushPending(); }
  async requestHistory<T = CommunicationMessageResponse>(conversationId: string, beforeConversationSeq?: number, limit = 50): Promise<ImHistoryPage<T>> {
    const key = `${beforeConversationSeq ?? "latest"}:${limit}`;
    const active = this.historyInFlight.get(conversationId);
    if (active) {
      if (active.key === key) return active.promise as Promise<ImHistoryPage<T>>;
      throw new Error("该会话正在加载历史消息");
    }
    const promise = (async () => {
      if (beforeConversationSeq !== undefined) {
        const local = await this.store.getMessages(conversationId, beforeConversationSeq, limit);
        if (local.length) return { conversationId, items: local, nextBeforeConversationSeq: local[0].sequence, hasMore: true };
      }
      const page = await this.sendCommand("history", { conversationId, beforeConversationSeq, limit }) as ImHistoryPage<CommunicationMessageResponse>;
      await this.store.putMessages(page.items);
      return page;
    })();
    this.historyInFlight.set(conversationId, { key, promise });
    try { return await promise as ImHistoryPage<T>; }
    finally { if (this.historyInFlight.get(conversationId)?.promise === promise) this.historyInFlight.delete(conversationId); }
  }
  markRead(conversationId: string, sequence: number) { return this.sendCommand("ack", { conversationId, mailboxSeq: sequence }); }
  sendTransient(action: "conversation.typing" | "conversation.presence", data: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: action, action, data, conversationId: data.conversationId }));
  }
  private sendRaw(action: string, data: unknown, requestId = crypto.randomUUID()) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("IM 尚未连接");
    this.socket.send(JSON.stringify(createImRequest(action, data, requestId)));
  }
  private async handleEnvelope(envelope: ImEnvelope) {
    if (envelope.event === "sync.reset_required") {
      const oldest = (envelope.data as { oldestMailboxSeq?: number } | undefined)?.oldestMailboxSeq ?? 1;
      const baseline = Math.max(0, oldest - 1);
      await this.store.resetSync(baseline); this.cursor = baseline; this.buffered.clear(); this.snapshotComplete = false; this.setState("reset_required");
      this.sendRaw("sync", { deviceId: this.options.deviceId ?? "web", lastMailboxSeq: baseline }); return;
    }
    if (envelope.event === "snapshot.started") { this.snapshotComplete = false; this.setState("syncing"); }
    if (envelope.event === "conversation.snapshot") {
      const data = envelope.data as { items?: CommunicationConversationResponse[] } | undefined;
      if (data?.items) await this.store.putConversations(data.items);
    }
    if (typeof envelope.mailboxSeq === "number" && envelope.event !== "snapshot.completed") {
      const seq = envelope.mailboxSeq;
      if (seq > this.cursor) {
        this.buffered.set(seq, envelope); await this.drainMailbox();
        if (this.buffered.size && !this.buffered.has(this.cursor + 1) && !this.syncRequested) {
          this.syncRequested = true;
          this.emit({ type: "event", event: "mailbox.gap", data: { expected: this.cursor + 1, received: seq } });
          this.sendRaw("sync", { deviceId: this.options.deviceId ?? "web", lastMailboxSeq: this.cursor });
        }
      }
      return;
    }
    if (envelope.event === "snapshot.completed") {
      this.snapshotComplete = true;
      this.snapshotTarget = envelope.mailboxSeq ?? (envelope.data as { mailboxSeq?: number } | undefined)?.mailboxSeq ?? this.cursor;
      this.completeSnapshot();
    }
    if (envelope.type === "response" && envelope.requestId) this.resolvePending(envelope);
    if (envelope.event === "history.page" && envelope.requestId) this.resolvePending(envelope);
    this.emit(envelope);
  }
  private async drainMailbox() {
    let advanced = false;
    while (this.buffered.has(this.cursor + 1)) {
      const seq = this.cursor + 1;
      const envelope = this.buffered.get(seq)!;
      const payload = envelope.data as Record<string, unknown> | undefined;
      const message = (envelope.event === "message.created" || envelope.event === "message.recalled") && payload && (payload.id || payload.messageId)
        ? { ...payload, id: payload.id ?? payload.messageId, conversationId: payload.conversationId ?? envelope.conversationId, sequence: payload.sequence ?? envelope.conversationSeq } as CommunicationMessageResponse
        : undefined;
      const committed = await this.store.applyMailboxEvent(seq, message);
      if (committed < seq) break;
      this.cursor = committed;
      for (const bufferedSeq of this.buffered.keys()) if (bufferedSeq <= committed) this.buffered.delete(bufferedSeq);
      this.syncRequested = false; advanced = true; this.emit(envelope);
    }
    if (advanced && this.socket?.readyState === WebSocket.OPEN) this.sendRaw("ack", { mailboxSeq: this.cursor });
    this.completeSnapshot();
  }
  private completeSnapshot() {
    if (this.snapshotComplete && this.cursor >= this.snapshotTarget && this.state !== "online") {
      this.reconnectAttempt = 0; this.setState("online"); void this.flushPending();
    }
  }
  private resolvePending(envelope: ImEnvelope) {
    const item = this.pending.get(envelope.requestId!);
    if (!item) return;
    window.clearTimeout(item.timer); this.pending.delete(envelope.requestId!);
    if (envelope.ok === false) item.reject(new Error("IM 请求失败"));
    else item.resolve(envelope.data);
  }
  private async flushPending() {
    if (this.state !== "online") return;
    const pending = await this.store.getPending();
    for (const item of pending) {
      if (this.sending.has(item.localId)) continue;
      this.sending.add(item.localId);
      try { await this.sendCommand("send", item); this.emit({ type: "event", event: "message.submitted", localId: item.localId, conversationId: item.conversationId }); }
      catch (error) { this.emit({ type: "event", event: "message.retry_pending", localId: item.localId, conversationId: item.conversationId, data: error }); }
      finally { this.sending.delete(item.localId); }
    }
  }
  private scheduleReconnect() {
    this.setState("reconnecting");
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; void this.connect(); }, delay);
  }
  private emit(envelope: ImEnvelope) { this.listeners.forEach((listener) => listener(envelope)); }
  private setState(state: ImConnectionState) { this.state = state; this.emit({ type: "event", event: "connection.state", data: { state } }); }
}
