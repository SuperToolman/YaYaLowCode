import { jsonRequest, openEventStream, requestApi } from "@/app/lib/api-request";
import type { AgentApprovalMode, AgentMessage, AgentOption, AgentPageContext, AgentRunTrace, AgentSession, PendingAction } from "./types";

export async function fetchAgentSessions() {
  return requestApi<AgentSession[]>("/api/agent/sessions", { cache: "no-store" });
}

export function fetchAvailableAgents(context: AgentPageContext) {
  const search = new URLSearchParams();
  if (context.appId) search.set("appId", context.appId);
  const query = search.size ? `?${search.toString()}` : "";
  return requestApi<AgentOption[]>(`/api/agent/available-agents${query}`, { cache: "no-store" });
}

export async function fetchAgentMessages(sessionId: string) {
  return (await requestApi<AgentMessage[]>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { cache: "no-store" }))
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
  const search = new URLSearchParams({ route: context.route });
  if (context.appId) search.set("appId", context.appId);
  if (context.formUuid) search.set("formUuid", context.formUuid);
  void agentId;
  void source;
  return requestApi<AgentSession>(`/api/agent/sessions?${search.toString()}`, { method: "POST" });
}

export async function updateAgentSessionData(sessionId: string, update: { title?: string; isPinned?: boolean }) {
  return requestApi<AgentSession>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, jsonRequest(update, { method: "PATCH" }));
}

export async function deleteAgentSessionData(sessionId: string) {
  return requestApi<{ id: string }>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
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
