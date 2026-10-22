import { unwrapApiResult, requestApi } from "@/app/lib/api-request";
import { readAuthStorage, AUTH_TOKEN_STORAGE_KEY } from "@/app/lib/auth";
import { getSystemAiStatus } from "@lib/http";
import * as sdk from "@lib/http";
import type { AgentOption, AgentPageContext, AgentSession } from "@/features/agent-assistant/types";

function authInit(init: Pick<RequestInit, "cache" | "credentials"> = {}) {
  const token = typeof window === "undefined" ? null : readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return token ? { ...init, headers: { authorization: `Bearer ${token}` } } : init;
}

export type AgentWorkbenchSession = Omit<sdk.ApiAgentRuntimeSummary, "phase" | "lastToolName" | "lastError"> & AgentSession & { phase?: string; lastToolName?: string; lastError?: string };
export type ArchivedAgentSession = AgentSession & { archivedAt?: string | null };
export type AgentFile = sdk.AgentFileResponse;
function sessionView(session: sdk.ApiAgentSession): AgentSession {
  return { ...session, source: session.source === "form_fill" ? "form_fill" : "general", appId: session.appId ?? undefined };
}

export type AgentWorkbenchDirectoryFilter = {
  cursor?: string;
  query?: string;
  agentId?: string;
  runStatus?: AgentWorkbenchSession["runStatus"] | "queued" | "waiting_approval";
};

export async function fetchAgentWorkbenchSessions(filter: AgentWorkbenchDirectoryFilter = {}) {
  const page = unwrapApiResult(await sdk.listAgentWorkbenchSessions({ query: { ...filter, limit: 80 }, ...authInit({ cache: "no-store" }) }));
  return { ...page, nextCursor: page.nextCursor ?? undefined, items: page.items.map((item): AgentWorkbenchSession => ({ ...item, ...sessionView(item), appId: sessionView(item).appId, phase: item.phase ?? undefined, lastToolName: item.lastToolName ?? undefined, lastError: item.lastError ?? undefined })) };
}
export function fetchAvailableAgents(context: AgentPageContext) {
  const search = new URLSearchParams();
  if (context.appId) search.set("appId", context.appId);
  const query = search.size ? `?${search.toString()}` : "";
  return requestApi<AgentOption[]>(`/api/agent/available-agents${query}`, authInit({ cache: "no-store" }));
}
export async function fetchSystemAiStatus() { return unwrapApiResult(await getSystemAiStatus()); }
export async function fetchAgentFiles(sessionId: string) { return unwrapApiResult(await sdk.listAgentFiles({ path: { sessionId }, ...authInit() })); }
export async function fetchAgentArtifacts(sessionId: string) { return unwrapApiResult(await sdk.listAgentArtifacts({ path: { sessionId }, query: { kind: "output" }, ...authInit() })); }
export async function uploadAgentFile(sessionId: string, file: File) {
  const uploaded = unwrapApiResult(await sdk.uploadAgentFile({ path: { sessionId }, body: { file }, ...authInit() }));
  return { ...uploaded, kind: "input" };
}
export function agentFileDownloadUrl(sessionId: string, fileId: string) { return `/api/agent/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}`; }
export async function updateAgentSessionData(sessionId: string, body: sdk.UpdateAgentSessionRequest) { return sessionView(unwrapApiResult(await sdk.updateAgentSession({ path: { sessionId }, body, ...authInit() }))); }
export async function archiveAgentSession(sessionId: string) { const result = await sdk.deleteAgentSession({ path: { sessionId }, ...authInit() }); if (result.error) throw result.error; }
export async function fetchArchivedAgentSessions() { return unwrapApiResult(await sdk.listArchivedAgentSessions({ ...authInit() })).map(session => ({ ...sessionView(session), archivedAt: session.archivedAt })); }
export async function restoreArchivedAgentSession(sessionId: string) { return sessionView(unwrapApiResult(await sdk.restoreAgentSession({ path: { sessionId }, ...authInit() }))); }
export async function purgeArchivedAgentSession(sessionId: string) { const result = await sdk.purgeAgentSession({ path: { sessionId }, ...authInit() }); if (result.error) throw result.error; }
