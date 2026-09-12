import {
  jsonRequest,
  openEventStream,
  requestApi,
} from "@/app/lib/api-request";
import { readAuthStorage, AUTH_TOKEN_STORAGE_KEY } from "@/app/lib/auth";
import type {
  AgentMessage,
  AgentOption,
  AgentPageContext,
  AgentRunTrace,
  AgentRuntimeStatus,
  AgentSession,
} from "./types";

function authInit(init: RequestInit = {}): RequestInit {
  const token =
    typeof window === "undefined"
      ? null
      : readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return token
    ? {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
      }
    : init;
}

export async function fetchAgentSessions() {
  return requestApi<AgentSession[]>(
    "/api/agent/sessions",
    authInit({ cache: "no-store" }),
  );
}

export function fetchAvailableAgents(context: AgentPageContext) {
  const search = new URLSearchParams();
  if (context.appId) search.set("appId", context.appId);
  const query = search.size ? `?${search.toString()}` : "";
  return requestApi<AgentOption[]>(`/api/agent/available-agents${query}`, {
    cache: "no-store",
  });
}

export async function fetchAgentMessages(sessionId: string) {
  return (
    await requestApi<AgentMessage[]>(
      `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
      authInit({ cache: "no-store" }),
    )
  ).filter(
    (message) =>
      message.role !== "assistant" ||
      Boolean(message.content?.trim()) ||
      Boolean(message.reasoning) ||
      Boolean(message.timeline?.length) ||
      Boolean(message.toolActivities?.length),
  );
}

export type AgentRuntimeState = {
  status: AgentRuntimeStatus;
  startedAt?: string;
  lastToolName?: string;
};
export function fetchAgentRunStatus(sessionId: string) {
  return requestApi<AgentRuntimeState>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/runtime-status`,
    authInit({ cache: "no-store" }),
  );
}
export function cancelAgentRun(sessionId: string) {
  return requestApi<{ status: "stopping" }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`,
    authInit({ method: "POST" }),
  );
}

export async function createAgentSessionData(
  context: AgentPageContext,
  agentId = "cordis-default",
  source: "general" | "form_fill" = "general",
) {
  const search = new URLSearchParams({ route: context.route });
  if (context.appId) search.set("appId", context.appId);
  if (context.formUuid) search.set("formUuid", context.formUuid);
  void source;
  return requestApi<AgentSession>(
    `/api/agent/sessions?${search.toString()}`,
    authInit(jsonRequest({ agentId, context }, { method: "POST" })),
  );
}

export async function updateAgentSessionData(
  sessionId: string,
  update: { title?: string; isPinned?: boolean },
) {
  return requestApi<AgentSession>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
    jsonRequest(update, { method: "PATCH" }),
  );
}

export async function deleteAgentSessionData(sessionId: string) {
  return requestApi<{ id: string }>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}

export function openAgentMessageStream(
  sessionId: string,
  content: string,
  context: AgentPageContext,
  agentId?: string,
  signal?: AbortSignal,
  fileIds?: string[],
) {
  const token =
    typeof window === "undefined"
      ? null
      : readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return openEventStream(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
    jsonRequest(
      {
        content,
        context,
        ...(agentId ? { agentId } : {}),
        ...(fileIds?.length ? { fileIds } : {}),
      },
      {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        signal,
      },
    ),
  );
}

export type AgentFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: string;
  checksum?: string;
};
export function fetchAgentFiles(sessionId: string) {
  return requestApi<AgentFile[]>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/files`,
    authInit({ cache: "no-store" }),
  );
}
export function fetchAgentArtifacts(sessionId: string) {
  return requestApi<AgentFile[]>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts?kind=output`,
    authInit({ cache: "no-store" }),
  );
}
export async function uploadAgentFile(sessionId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const token =
    typeof window === "undefined"
      ? null
      : readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return requestApi<AgentFile>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/files`,
    {
      method: "POST",
      body: form,
      credentials: "include",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    },
  );
}
export function agentFileDownloadUrl(sessionId: string, fileId: string) {
  return `/api/agent/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}`;
}

export function fetchAgentRunTrace(sessionId: string, runId: string) {
  return requestApi<AgentRunTrace>(
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/trace`,
    { cache: "no-store" },
  );
}
