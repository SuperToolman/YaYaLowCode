import {
  createAgentSession,
  deleteAgentSession,
  listAgentMessages,
  listAgentSessions,
  updateAgentSession,
} from "@/app/lib/api-client";
import { ApiRequestError, jsonRequest, openEventStream, requestApi, type ApiEnvelope } from "@/app/lib/api-request";
import type { AgentApprovalMode, AgentMessage, AgentOption, AgentPageContext, AgentRunTrace, AgentSession, PendingAction } from "./types";

function unwrap<T>(data: ApiEnvelope<T> | undefined, error: unknown, fallback: string): T {
  if (error || data?.code !== 0 || !data.data) {
    throw new ApiRequestError(data?.message || fallback, 0, "business", data?.code, { cause: error });
  }
  return data.data;
}

export async function fetchAgentSessions() {
  const { data, error } = await listAgentSessions({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<AgentSession[]> | undefined, error, "无法加载 Agent 会话");
}

export function fetchAvailableAgents(context: AgentPageContext) {
  const search = new URLSearchParams();
  if (context.appId) search.set("appId", context.appId);
  const query = search.size ? `?${search.toString()}` : "";
  return requestApi<AgentOption[]>(`/api/agent/available-agents${query}`, { cache: "no-store" });
}

export async function fetchAgentMessages(sessionId: string) {
  const { data, error } = await listAgentMessages({ path: { sessionId }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<AgentMessage[]> | undefined, error, "无法加载 Agent 消息")
    .filter((message) => !isPendingActionAuditMessage(message));
}

export function fetchPendingActions(sessionId: string) {
  return requestApi<PendingAction[]>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions`,
    { cache: "no-store" },
  );
}

function isPendingActionAuditMessage(message: AgentMessage) {
  if (!message.metadata || typeof message.metadata !== "object" || Array.isArray(message.metadata)) return false;
  const metadata = message.metadata as Record<string, unknown>;
  return typeof metadata.pendingActionId === "string"
    && (metadata.status === "confirmed" || metadata.status === "completed");
}

export async function createAgentSessionData(context: AgentPageContext, agentId?: string, source: "general" | "form_fill" = "general") {
  const { data, error } = await createAgentSession({ body: { agentId, source, context }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<AgentSession> | undefined, error, "无法创建 Agent 会话");
}

export async function updateAgentSessionData(sessionId: string, update: { title?: string; isPinned?: boolean }) {
  const { data, error } = await updateAgentSession({ path: { sessionId }, body: update, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<AgentSession> | undefined, error, "无法更新 Agent 会话");
}

export async function deleteAgentSessionData(sessionId: string) {
  const { data, error } = await deleteAgentSession({ path: { sessionId }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<{ id: string }> | undefined, error, "无法删除 Agent 会话");
}

export function openAgentMessageStream(sessionId: string, content: string, context: AgentPageContext, approvalMode: AgentApprovalMode, signal?: AbortSignal) {
  return openEventStream(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
    jsonRequest({ content, context, approvalMode }, {
      method: "POST",
      headers: { accept: "text/event-stream" },
      signal,
    }),
  );
}

export function resolvePendingAction(sessionId: string, actionId: string, operation: "confirm" | "cancel") {
  return requestApi<unknown>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions/${encodeURIComponent(actionId)}/${operation}`,
    { method: "POST" },
  );
}

export function fetchAgentRunTrace(sessionId: string, runId: string) {
  return requestApi<AgentRunTrace>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/trace`,
    { cache: "no-store" },
  );
}
