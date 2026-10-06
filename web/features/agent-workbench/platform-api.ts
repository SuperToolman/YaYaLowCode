import { jsonRequest, requestApi } from "@/app/lib/api-request";
import { readAuthStorage, AUTH_TOKEN_STORAGE_KEY } from "@/app/lib/auth";
import { getSystemAiStatus } from "@lib/api-client";
import { ApiRequestError } from "@lib/api-request";
import type { AgentOption, AgentPageContext, AgentSession } from "@/features/agent-assistant/types";

function authInit(init: RequestInit = {}): RequestInit {
  const token = typeof window === "undefined" ? null : readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return token ? { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } } : init;
}

export type AgentWorkbenchSession = AgentSession & {
  eventGeneration: string;
  lastEventSeq: number;
  runStatus: "running" | "completed" | "failed" | "stopped" | "idle";
  phase?: string;
  lastToolName?: string;
  lastError?: string;
  pendingApprovalCount: number;
  unreadActivityVersion: number;
  lastActivityAt: string;
};
export type ArchivedAgentSession = AgentSession & { archivedAt?: string | null };
export type AgentFile = { id: string; name: string; size: number; mimeType: string; kind: string; checksum?: string };

export type AgentWorkbenchDirectoryFilter = {
  cursor?: string;
  query?: string;
  agentId?: string;
  runStatus?: AgentWorkbenchSession["runStatus"] | "queued" | "waiting_approval";
};

export async function fetchAgentWorkbenchSessions(filter: AgentWorkbenchDirectoryFilter = {}) {
  const search = new URLSearchParams({ limit: "80" });
  if (filter.cursor) search.set("cursor", filter.cursor);
  if (filter.query?.trim()) search.set("query", filter.query.trim());
  if (filter.agentId?.trim()) search.set("agentId", filter.agentId.trim());
  if (filter.runStatus) search.set("runStatus", filter.runStatus);
  return requestApi<{ items: AgentWorkbenchSession[]; nextCursor?: string }>(`/api/agent/workbench/sessions?${search.toString()}`, authInit({ cache: "no-store" }));
}
export function fetchAvailableAgents(context: AgentPageContext) {
  const search = new URLSearchParams();
  if (context.appId) search.set("appId", context.appId);
  const query = search.size ? `?${search.toString()}` : "";
  return requestApi<AgentOption[]>(`/api/agent/available-agents${query}`, authInit({ cache: "no-store" }));
}
export async function fetchSystemAiStatus<T>() {
  const { data, error } = await getSystemAiStatus({ responseStyle: "fields" });
  if (error || data?.code !== 0 || data.data === null) throw new ApiRequestError(data?.message || "无法加载系统 AI 状态", 0, "business", data?.code, { cause: error });
  return data.data as T;
}
export function fetchAgentFiles(sessionId: string) { return requestApi<AgentFile[]>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/files`, authInit({ cache: "no-store" })); }
export function fetchAgentArtifacts(sessionId: string) { return requestApi<AgentFile[]>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts?kind=output`, authInit({ cache: "no-store" })); }
export async function uploadAgentFile(sessionId: string, file: File) {
  const form = new FormData(); form.append("file", file);
  return requestApi<AgentFile>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/files`, authInit({ method: "POST", body: form, credentials: "include" }));
}
export function agentFileDownloadUrl(sessionId: string, fileId: string) { return `/api/agent/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}`; }
export function updateAgentSessionData(sessionId: string, update: { title?: string; isPinned?: boolean }) { return requestApi<AgentSession>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, authInit(jsonRequest(update, { method: "PATCH" }))); }
export function archiveAgentSession(sessionId: string) { return requestApi<void>(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, authInit({ method: "DELETE" })); }
export function fetchArchivedAgentSessions() { return requestApi<ArchivedAgentSession[]>("/api/agent/archived-sessions", authInit({ cache: "no-store" })); }
export function restoreArchivedAgentSession(sessionId: string) { return requestApi<ArchivedAgentSession>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/restore`, authInit({ method: "POST" })); }
export function purgeArchivedAgentSession(sessionId: string) { return requestApi<void>(`/api/agent/sessions/${encodeURIComponent(sessionId)}/purge`, authInit({ method: "DELETE" })); }
