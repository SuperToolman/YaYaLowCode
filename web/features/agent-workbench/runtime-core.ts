import type { AgentMessage, AgentRunStatus } from "@/features/agent-assistant/types";
import type { AgentWorkbenchSession } from "@/features/agent-workbench/platform-api";
import { createConversationProjection, type ConnectionState, type ConversationNode, type ConversationSnapshot, type DshEvent, type MuxFrame } from "@yaya/dsh-workbench-client";

export type CommandState = { id: string; method: string };
export type SessionState = {
  canonicalEvents: DshEvent[];
  conversation: ConversationSnapshot;
  conversationNodes: readonly ConversationNode[];
  messages: AgentMessage[];
  lastSeq: number;
  oldestSeq: number | null;
  generation: string;
  runStatus: AgentRunStatus;
  phase?: string;
  lastToolName?: string;
  pendingApprovalCount: number;
  unread: boolean;
  unreadVersion: number;
  connection: ConnectionState;
  stale: boolean;
  historyLoading: boolean;
  historyHasMore: boolean;
  command?: CommandState;
  commandError?: string;
  queue: unknown[];
  approvals: unknown[];
  questions: unknown[];
  subagents: unknown[];
  jobs: unknown[];
  artifacts: unknown[];
  draft: string;
};

function summaryStatus(status: string): AgentRunStatus {
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  if (status === "running" || status === "queued") return "thinking";
  if (status === "waiting_approval") return "working";
  return "completed";
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join("");
  return typeof value === "object" && value !== null && "text" in value
    ? String((value as { text?: unknown }).text ?? "")
    : "";
}

export function messagesFrom(sessionId: string, events: readonly DshEvent[]): AgentMessage[] {
  const result: AgentMessage[] = [];
  for (const event of events) {
    if (event.type === "user/message") {
      const content = text(event.data.message ?? event.data.content);
      if (content) result.push({ id: `${sessionId}:${event.seq}`, sessionId, role: "user", content, createdAt: new Date(event.time).toISOString() });
      continue;
    }
    if (event.type === "assistant/chunk") {
      const chunk = event.data.chunk as { type?: string; text?: string } | undefined;
      if (!chunk?.text) continue;
      const last = result.at(-1);
      const message = last?.role === "assistant"
        ? { ...last }
        : { id: `${sessionId}:assistant:${event.seq}`, sessionId, role: "assistant" as const, content: "", reasoning: "", timeline: [] };
      if (chunk.type === "reasoning-delta") message.reasoning = `${message.reasoning ?? ""}${chunk.text}`;
      if (chunk.type === "text-delta") message.content = `${message.content}${chunk.text}`;
      if (last?.role === "assistant") result[result.length - 1] = message;
      else result.push(message);
      continue;
    }
    if (event.type === "assistant/message") {
      const content = text(event.data.message ?? event.data.content);
      if (content && result.at(-1)?.role !== "assistant") result.push({ id: `${sessionId}:${event.seq}`, sessionId, role: "assistant", content, createdAt: new Date(event.time).toISOString() });
    }
  }
  return result;
}

function messagesFromConversation(sessionId: string, nodes: readonly ConversationNode[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const node of nodes) {
    if (node.kind === "user") messages.push({ id: node.id, sessionId, role: "user", content: node.text, createdAt: new Date(node.time).toISOString() });
    if (node.kind === "assistant") messages.push({ id: node.id, sessionId, role: "assistant", content: node.text, createdAt: new Date(node.time).toISOString() });
    if (node.kind === "reasoning") {
      const assistant = messages.at(-1);
      if (assistant?.role === "assistant") assistant.reasoning = `${assistant.reasoning ?? ""}${node.text}`;
      else messages.push({ id: node.id, sessionId, role: "assistant", content: "", reasoning: node.text, createdAt: new Date(node.time).toISOString() });
    }
    if (node.kind === "tool") {
      const assistant = messages.at(-1);
      const activity = { id: node.id, name: node.name, status: node.status === "running" ? "running" as const : "completed" as const, arguments: node.arguments, result: node.result, ...(node.status === "failed" ? { error: node.result } : {}) };
      if (assistant?.role === "assistant") assistant.toolActivities = [...(assistant.toolActivities ?? []), activity];
      else messages.push({ id: node.id, sessionId, role: "assistant", content: "", toolActivities: [activity], createdAt: new Date(node.time).toISOString() });
    }
    if (node.kind === "error" || node.kind === "fallback") messages.push({ id: node.id, sessionId, role: "assistant", content: node.kind === "error" ? node.message : `[${node.eventType}] ${node.text}`, createdAt: new Date(node.time).toISOString() });
  }
  return messages;
}

function statusFor(event: DshEvent, previous: AgentRunStatus): AgentRunStatus {
  if (event.type === "turn/start") return "thinking";
  if (event.type === "tool/call") return "working";
  if (event.type === "assistant/chunk" || event.type === "assistant/message") return "responding";
  if (event.type === "tool/result" && (event.data.error === true || event.data.isError === true)) return "failed";
  if (event.type !== "turn/end") return previous;
  const reason = event.data.reason as { kind?: string } | undefined;
  if (reason?.kind === "error") return "failed";
  if (["aborted", "interrupted", "disposed"].includes(reason?.kind ?? "")) return "stopped";
  return "completed";
}

function phaseFor(event: DshEvent, previous?: string): string | undefined {
  if (event.type === "turn/start") return "thinking";
  if (event.type === "tool/call") return "tool";
  if (event.type === "assistant/chunk" || event.type === "assistant/message") return "responding";
  if (event.type === "tool/result" && (event.data.error === true || event.data.isError === true)) return "error";
  if (event.type !== "turn/end") return previous;
  return (event.data.reason as { kind?: string } | undefined)?.kind === "error" ? "error" : "idle";
}

export function createInitialSessionState(session: AgentWorkbenchSession): SessionState {
  return {
    canonicalEvents: [], conversation: createConversationProjection().snapshot(), conversationNodes: [], messages: [], lastSeq: session.lastEventSeq, oldestSeq: null,
    generation: session.eventGeneration, runStatus: summaryStatus(session.runStatus), phase: session.phase,
    lastToolName: session.lastToolName, pendingApprovalCount: session.pendingApprovalCount,
    unread: false, unreadVersion: session.unreadActivityVersion, connection: "connecting", stale: false,
    historyLoading: false, historyHasMore: true, queue: [], approvals: [], questions: [], subagents: [], jobs: [], artifacts: [], draft: "",
  };
}

export function mergeHistory(state: SessionState, sessionId: string, incoming: readonly DshEvent[], mode: "append" | "prepend" | "reset" = "append"): SessionState {
  const events = new Map((mode === "reset" ? [] : state.canonicalEvents).map(event => [event.seq, event]));
  for (const event of incoming) events.set(event.seq, event);
  const canonicalEvents = [...events.values()].sort((a, b) => a.seq - b.seq);
  const projection = createConversationProjection();
  const conversation = projection.replaceWindow(canonicalEvents, state.historyHasMore);
  return {
    ...state,
    canonicalEvents,
    conversation,
    conversationNodes: conversation.nodes,
    messages: messagesFromConversation(sessionId, conversation.nodes),
    lastSeq: Math.max(mode === "reset" ? -1 : state.lastSeq, canonicalEvents.at(-1)?.seq ?? -1),
    oldestSeq: canonicalEvents[0]?.seq ?? null,
    // Older pages are transcript-only. Their old turn/start events must never
    // overwrite the latest state established by the tail or mux stream.
    runStatus: mode === "prepend" ? state.runStatus : incoming.reduce((value, event) => statusFor(event, value), mode === "reset" ? "completed" : state.runStatus),
    phase: mode === "prepend" ? state.phase : incoming.reduce((value, event) => phaseFor(event, value), mode === "reset" ? undefined : state.phase),
  };
}

export type FrameEffect = { kind: "history-gap" | "generation-reset"; sessionId: string } | null;

export function reduceSessionFrame(state: SessionState, sessionId: string, frame: MuxFrame, active: boolean): { state: SessionState; effect: FrameEffect } {
  if (frame.type === "session/subscribed") {
    const generation = String(frame.generation ?? state.generation);
    if (generation !== state.generation) {
      const conversation = createConversationProjection().snapshot();
      return { state: { ...state, generation, canonicalEvents: [], conversation, conversationNodes: [], messages: [], lastSeq: -1, oldestSeq: null, stale: false }, effect: { kind: "generation-reset", sessionId } };
    }
    const remoteLastSeq = Number(frame.lastSeq ?? state.lastSeq);
    return { state: { ...state, stale: false }, effect: remoteLastSeq > state.lastSeq + 1 ? { kind: "history-gap", sessionId } : null };
  }
  if (frame.type === "session/event" && frame.event) {
    if (frame.event.generation && frame.event.generation !== state.generation) return { state, effect: null };
    if (frame.event.seq <= state.lastSeq) return { state, effect: null };
    const next = mergeHistory(state, sessionId, [frame.event]);
    return { state: { ...next, unread: active ? next.unread : true, unreadVersion: active ? next.unreadVersion : next.unreadVersion + 1 }, effect: null };
  }
  const items = (frame as Record<string, unknown>).items ?? (frame as Record<string, unknown>).jobs;
  const key = frame.type.includes("approval") ? "approvals" : frame.type.includes("question") ? "questions" : frame.type.includes("subagent") ? "subagents" : frame.type.includes("jobs") ? "jobs" : frame.type.includes("queue") ? "queue" : frame.type.includes("artifact") ? "artifacts" : undefined;
  if (!key) return { state, effect: null };
  const existing = state[key];
  const next = { ...state, ...(Array.isArray(items) ? { [key]: items } : {}) } as SessionState;
  const wasPresent = existing.some(item => (item as { rpcId?: unknown }).rpcId === frame.rpcId || (item as { approvalId?: unknown }).approvalId === (frame as Record<string, unknown>).approvalId);
  if (frame.type === "approval/requested" || frame.type === "question/requested") next[key] = [...existing.filter(item => (item as { rpcId?: unknown }).rpcId !== frame.rpcId), frame];
  if (frame.type === "approval/requested" && !wasPresent) next.pendingApprovalCount += 1;
  if (frame.type === "approval/resolved") { next.pendingApprovalCount = Math.max(0, next.pendingApprovalCount - 1); const id = (frame as Record<string, unknown>).approvalId; next.approvals = existing.filter(item => (item as { approvalId?: unknown }).approvalId !== id); }
  if (frame.type === "question/resolved") {
    const resolvedRpcId = frame.rpcId ?? (frame as Record<string, unknown>).questionRpcId;
    next.questions = existing.filter(item => (item as { rpcId?: unknown }).rpcId !== resolvedRpcId);
  }
  return { state: next, effect: null };
}

export function setConnectionState(state: SessionState, connection: ConnectionState): SessionState {
  return { ...state, connection, stale: connection === "stale" };
}
