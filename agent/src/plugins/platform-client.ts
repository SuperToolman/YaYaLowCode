import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentIdentity, AgentRequestContext, PendingAction, PlatformClient } from "../contracts.js";

export function createPlatformClient(baseUrl: string) {
  return class RustPlatformClient extends Service implements PlatformClient {
    constructor(ctx: Context) {
      super(ctx, "platform");
    }

    async request<T>(context: AgentRequestContext, path: string, init: RequestInit = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { accept: "application/json", authorization: context.authorization, ...init.headers },
      });
      const body = await response.json().catch(() => undefined) as { code?: number; data?: T; message?: string } | undefined;
      if (!response.ok || body?.code !== 0) throw new Error(body?.message ?? `Platform request failed (${response.status})`);
      return body.data as T;
    }

    async identity(authorization: string): Promise<AgentIdentity> {
      const response = await fetch(`${baseUrl}/api/agent/runtime-identity`, {
        headers: { accept: "application/json", authorization },
      });
      const body = await response.json().catch(() => undefined) as { code?: number; data?: AgentIdentity; message?: string } | undefined;
      if (!response.ok || body?.code !== 0 || !body.data) throw new Error(body?.message ?? `Platform identity request failed (${response.status})`);
      return body.data;
    }

    async createPendingAction(context: AgentRequestContext, action: Omit<PendingAction, "id" | "sessionId" | "status" | "createdAt" | "completedAt" | "errorMessage"> & { sessionId: string }) {
      const result = await this.request<PlatformPendingAction>(context, `/api/agent/sessions/${encodeURIComponent(action.sessionId)}/pending-actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionType: action.actionType, payload: action.payload, summary: action.summary, expiresAt: action.expiresAt }),
      });
      return normalizePendingAction(result, action.sessionId, action.payload);
    }

    async listPendingActions(context: AgentRequestContext, sessionId: string) {
      const result = await this.request<PlatformPendingAction[]>(context, `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions`);
      return result.map((action) => normalizePendingAction(action, sessionId));
    }

    confirmPendingAction(context: AgentRequestContext, sessionId: string, actionId: string) {
      return this.request<unknown>(context, `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions/${encodeURIComponent(actionId)}/confirm`, { method: "POST" });
    }

    async cancelPendingAction(context: AgentRequestContext, sessionId: string, actionId: string) {
      await this.request(context, `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions/${encodeURIComponent(actionId)}/cancel`, { method: "POST" });
    }
  };
}

type PlatformPendingAction = {
  id: string;
  actionType: string;
  summary: string;
  status: PendingAction["status"];
  createdAt: string;
  expiresAt: string;
  payload?: unknown;
};

function normalizePendingAction(action: PlatformPendingAction, sessionId: string, payload?: unknown): PendingAction {
  return { ...action, sessionId, payload: action.payload ?? payload ?? {} };
}
