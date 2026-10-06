import { readAuthStorage, AUTH_TOKEN_STORAGE_KEY } from "@/app/lib/auth";

export const DSH_WORKBENCH_CLIENT_VERSION = "0.1.0" as const;
export const DSH_PROTOCOL_VERSION = "0.1.0-rc.8" as const;
export const DSH_WORKBENCH_BASE_PATH = "/api/agent/dsh" as const;

function muxUrl() {
  const configured = process.env.NEXT_PUBLIC_AGENT_RUNTIME_WS_URL?.trim();
  if (configured) return `${configured.replace(/\/$/, "")}/api/agent/dsh/events.mux`;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}${DSH_WORKBENCH_BASE_PATH}/events.mux`;
}

export type RpcEnvelope<T = unknown> = {
  type: "server-response";
  rpcId: string;
  result: { ok: true; value: T } | { ok: false; error: { message: string; code?: string } };
};
export type DshEvent = { type: string; seq: number; time: number; data: Record<string, unknown>; [key: string]: unknown };
export type MuxFrame = {
  type: string;
  /** DSH server-request correlation id. Required to settle approval/question frames. */
  rpcId?: string;
  sessionId?: string;
  generation?: string;
  lastSeq?: number;
  event?: DshEvent;
  payload?: MuxFrame;
  [key: string]: unknown;
};
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "stale" | "closed";
export type ConversationNode =
  | { id: string; kind: "user" | "assistant" | "reasoning" | "fallback"; seq: number; time: number; text: string; eventType?: string }
  | { id: string; kind: "tool"; seq: number; time: number; name: string; status: "running" | "completed" | "failed"; arguments?: unknown; result?: unknown }
  | { id: string; kind: "error"; seq: number; time: number; message: string };
export type ConversationSnapshot = { nodes: readonly ConversationNode[]; hasMore: boolean };

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentText).join("");
  return typeof value === "object" && value !== null && "text" in value ? String((value as { text?: unknown }).text ?? "") : "";
}

function isUserAuthoredMessage(event: DshEvent): boolean {
  const source = event.data.source as { kind?: unknown } | undefined;
  // DSH deliberately encodes system-prompt snapshots as `user/message` so
  // the model receives them in context. They are protocol state, not chat.
  return source?.kind === undefined || source.kind === "user";
}

function isControlEvent(event: DshEvent): boolean {
  return ["agent/", "request/", "session/", "turn/", "step/", "permission/", "sandbox/", "approval/"].some(prefix => event.type.startsWith(prefix));
}

/**
 * Browser-safe adapter for the rc.8 canonical event model. It deliberately
 * mirrors the DSH ConversationNodeAssembler boundary without importing its
 * Cordis runtime or React 18 UI package.
 */
export function createConversationProjection() {
  let events: DshEvent[] = [];
  let hasMore = false;
  const snapshot = (): ConversationSnapshot => {
    const nodes: ConversationNode[] = [];
    const calls = new Map<string, number>();
    let assistant: { id: string; kind: "assistant"; seq: number; time: number; text: string } | undefined;
    for (const event of events) {
      if (event.type === "user/message") {
        if (isUserAuthoredMessage(event)) {
          nodes.push({ id: `user:${event.seq}`, kind: "user", seq: event.seq, time: event.time, text: contentText(event.data.content ?? event.data.message) });
          assistant = undefined;
        }
        continue;
      }
      if (event.type === "assistant/chunk") {
        const chunk = event.data.chunk as { type?: string; text?: string } | undefined;
        if (!chunk?.text) continue;
        const kind = chunk.type === "reasoning-delta" ? "reasoning" : "assistant";
        const previous = nodes.at(-1);
        if (previous?.kind === kind) { (previous as { text: string }).text += chunk.text; continue; }
        if (kind === "assistant") {
          assistant = { id: `assistant:${event.seq}`, kind: "assistant", seq: event.seq, time: event.time, text: chunk.text };
          nodes.push(assistant);
        } else {
          nodes.push({ id: `reasoning:${event.seq}`, kind: "reasoning", seq: event.seq, time: event.time, text: chunk.text });
        }
        continue;
      }
      if (event.type === "assistant/message") {
        const text = contentText(event.data.content ?? event.data.message);
        if (text) {
          if (assistant) assistant.text = text;
          else { assistant = { id: `assistant:${event.seq}`, kind: "assistant", seq: event.seq, time: event.time, text }; nodes.push(assistant); }
        }
        continue;
      }
      if (event.type === "tool/call") {
        const callId = String(event.data.callId ?? event.data.id ?? event.seq);
        calls.set(callId, nodes.length);
        nodes.push({ id: `tool:${callId}`, kind: "tool", seq: event.seq, time: event.time, name: String(event.data.name ?? "工具"), status: "running", arguments: event.data.arguments });
        continue;
      }
      if (event.type === "tool/result") {
        const callId = String(event.data.callId ?? (event.data.source as { callId?: unknown } | undefined)?.callId ?? "");
        const index = calls.get(callId);
        const failed = event.data.error === true || event.data.isError === true;
        if (index !== undefined) { const node = nodes[index]; if (node?.kind === "tool") { node.status = failed ? "failed" : "completed"; node.result = event.data.message ?? event.data.content ?? event.data.error; } }
        else nodes.push({ id: `tool:${event.seq}`, kind: "tool", seq: event.seq, time: event.time, name: callId || "工具结果", status: failed ? "failed" : "completed", result: event.data.message ?? event.data.content ?? event.data.error });
        continue;
      }
      if (event.type === "turn/end") {
        const reason = event.data.reason as { kind?: string } | undefined;
        const failed = reason?.kind === "error";
        for (const node of nodes) if (node.kind === "tool" && node.status === "running") node.status = failed ? "failed" : "completed";
      }
      if (event.type === "turn/end" && (event.data.reason as { kind?: string } | undefined)?.kind === "error") {
        const reason = event.data.reason as { message?: unknown; error?: unknown; failure?: { message?: unknown; code?: unknown } };
        const message = typeof reason.failure?.message === "string" ? reason.failure.message : typeof reason.message === "string" ? reason.message : typeof reason.error === "string" ? reason.error : typeof reason.failure?.code === "string" ? reason.failure.code : "Agent 执行失败";
        nodes.push({ id: `error:${event.seq}`, kind: "error", seq: event.seq, time: event.time, message });
        continue;
      }
      if (!isControlEvent(event)) nodes.push({ id: `event:${event.seq}`, kind: "fallback", seq: event.seq, time: event.time, text: JSON.stringify(event.data), eventType: event.type });
    }
    return { nodes, hasMore };
  };
  const set = (incoming: readonly DshEvent[], older: boolean, more: boolean) => { const bySeq = new Map(events.map(event => [event.seq, event])); for (const event of incoming) bySeq.set(event.seq, event); events = [...bySeq.values()].sort((a, b) => a.seq - b.seq); hasMore = more; return snapshot(); };
  return { replaceWindow: (incoming: readonly DshEvent[], more = false) => { events = []; return set(incoming, false, more); }, prependHistory: (incoming: readonly DshEvent[], more = false) => set(incoming, true, more), appendEvent: (event: DshEvent) => set([event], false, hasMore), snapshot, reset: () => { events = []; hasMore = false; return snapshot(); } };
}
export const MUX_FRAME_TYPES = new Set([
  "session/subscribed", "session/event", "session/queue", "session/jobs", "session/projection",
  "approval/requested", "approval/resolved", "question/requested", "question/resolved",
  "subagent/progress", "subagent/updated", "artifact/registered", "stream/error",
]);
const RPC_METHODS = new Set([
  "session.list", "session.search", "session.history", "session.prompt", "session.selectModel", "session.updateQueue",
  "session.cancel", "session.rename", "session.create", "session.fork", "respond",
  "subagent.list", "subagent.history", "subagent.prompt", "subagent.interrupt",
]);

export function validateRpcEnvelope<T>(value: unknown, rpcId: string, method?: string): value is RpcEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<RpcEnvelope<T>>;
  if (envelope.type !== "server-response" || envelope.rpcId !== rpcId || !envelope.result || typeof envelope.result !== "object") return false;
  if (method && !RPC_METHODS.has(method)) return false;
  return "ok" in envelope.result;
}

function authHeaders(): HeadersInit {
  const token = typeof window === "undefined" ? null : readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" };
}

export class YayaWorkbenchApiClient {
  readonly basePath = DSH_WORKBENCH_BASE_PATH;
  async rpc<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    if (!RPC_METHODS.has(method)) throw new Error(`Unsupported DSH RPC method: ${method}`);
    const rpcId = crypto.randomUUID();
    const response = await fetch(`${this.basePath}/${method}`, {
      method: "POST",
      headers: authHeaders(),
      credentials: "include",
      signal,
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    });
    const body = await response.json() as RpcEnvelope<T>;
    if (!validateRpcEnvelope<T>(body, rpcId, method)) throw new Error(`Invalid DSH RPC response for ${method}`);
    if (!response.ok || body.result?.ok !== true) {
      const error = body.result && !body.result.ok ? body.result.error.message : `RPC ${method} failed (${response.status})`;
      throw new Error(error);
    }
    return body.result.value;
  }
  list<T>(payload: unknown = {}) { return this.rpc<T>("session.list", payload); }
  search<T>(payload: unknown) { return this.rpc<T>("session.search", payload); }
  history<T>(payload: unknown) { return this.rpc<T>("session.history", payload); }
  prompt<T>(payload: unknown) { return this.rpc<T>("session.prompt", payload); }
  selectModel<T>(payload: unknown) { return this.rpc<T>("session.selectModel", payload); }
  updateQueue<T>(payload: unknown) { return this.rpc<T>("session.updateQueue", payload); }
  cancel<T>(payload: unknown) { return this.rpc<T>("session.cancel", payload); }
  rename<T>(payload: unknown) { return this.rpc<T>("session.rename", payload); }
  create<T>(payload: unknown = {}) { return this.rpc<T>("session.create", payload); }
  fork<T>(payload: unknown) { return this.rpc<T>("session.fork", payload); }
  respond<T>(payload: unknown) { return this.rpc<T>("respond", payload); }
  subagent<T>(method: "list" | "history" | "prompt" | "interrupt", payload: unknown) { return this.rpc<T>(`subagent.${method}`, payload); }
}

export function unwrapMuxFrame(value: unknown): MuxFrame | null {
  if (!value || typeof value !== "object") return null;
  const frame = value as MuxFrame;
  const payload = frame.payload && typeof frame.payload === "object" ? frame.payload : frame;
  if (typeof payload.type !== "string" || !MUX_FRAME_TYPES.has(payload.type)) return null;
  if (payload.type !== "stream/error" && typeof payload.sessionId !== "string") return null;
  if (payload.type === "session/event" && (!payload.event || typeof payload.event.seq !== "number" || typeof payload.event.type !== "string" || typeof payload.event.time !== "number" || !payload.event.data || typeof payload.event.data !== "object")) return null;
  return typeof frame.rpcId === "string" ? { ...payload, rpcId: frame.rpcId } : payload;
}

export class YayaMuxTransport {
  private socket?: WebSocket;
  private eventSource?: EventSource;
  private retry = 0;
  private stopped = false;
  private fallback = false;
  private timer?: number;
  constructor(private readonly onFrame: (frame: MuxFrame) => void, private readonly onState: (state: ConnectionState) => void) {}
  start() { this.stopped = false; this.connectSocket(); }
  stop() { this.stopped = true; if (this.timer) window.clearTimeout(this.timer); this.socket?.close(); this.eventSource?.close(); this.onState("closed"); }
  private connectSocket() {
    if (this.stopped) return;
    this.eventSource?.close();
    this.onState(this.retry ? "reconnecting" : "connecting");
    this.socket = new WebSocket(muxUrl());
    this.socket.onopen = () => { this.retry = 0; this.fallback = false; this.onState("connected"); };
    this.socket.onmessage = event => { try { const frame = unwrapMuxFrame(JSON.parse(String(event.data))); if (frame) this.onFrame(frame); } catch { /* ignore malformed frames */ } };
    this.socket.onerror = () => this.socket?.close();
    this.socket.onclose = () => { if (!this.stopped) this.scheduleReconnect(); };
  }
  private connectSse() {
    if (this.stopped) return;
    this.socket?.close();
    this.onState("reconnecting");
    this.eventSource = new EventSource(`${DSH_WORKBENCH_BASE_PATH}/events.mux`, { withCredentials: true });
    this.eventSource.onopen = () => { this.retry = 0; this.onState("connected"); };
    this.eventSource.onmessage = event => { try { const frame = unwrapMuxFrame(JSON.parse(event.data)); if (frame) this.onFrame(frame); } catch { /* ignore malformed frames */ } };
    this.eventSource.onerror = () => { this.eventSource?.close(); if (this.retry >= 6) this.onState("stale"); this.scheduleReconnect(); };
  }
  private scheduleReconnect() {
    if (this.stopped) return;
    this.retry += 1;
    if (this.retry >= 3 && !this.fallback) { this.fallback = true; this.connectSse(); return; }
    this.timer = window.setTimeout(() => this.connectSocket(), Math.min(10_000, 500 * 2 ** Math.min(this.retry, 4)));
  }
}

export const createClientCommandId = () => crypto.randomUUID();
