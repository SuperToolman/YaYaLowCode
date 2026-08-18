import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentRequestContext, AgentSessions } from "../contracts.js";

export class SessionService extends Service implements AgentSessions {
  static inject = ["storage", "platform"];

  constructor(ctx: Context) {
    super(ctx, "sessions");
  }

  list(context: AgentRequestContext) {
    return this.ctx.storage.listSessions(ownerKey(context));
  }

  async create(context: AgentRequestContext, title?: string) {
    const platformSession = await this.ctx.platform.request<{ id: string }>(context, "/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "cordis", context: { appId: context.appId, formUuid: context.formUuid, route: context.route } }),
    });
    return this.ctx.storage.createSession(ownerKey(context), title, platformSession.id);
  }

  async update(context: AgentRequestContext, sessionId: string, patch: { title: string }) {
    await this.requireSession(context, sessionId);
    const platformSession = await this.ctx.platform.request<{ id: string }>(context, `/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: patch.title }),
    });
    if (platformSession.id !== sessionId) throw new Error("Platform session update returned an unexpected session");
    const session = await this.ctx.storage.updateSession(ownerKey(context), sessionId, patch);
    if (!session) throw new Error("Agent session not found");
    return session;
  }

  async delete(context: AgentRequestContext, sessionId: string) {
    await this.requireSession(context, sessionId);
    await this.ctx.platform.request(context, `/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    await this.ctx.storage.deleteSession(ownerKey(context), sessionId);
  }

  async messages(context: AgentRequestContext, sessionId: string) {
    await this.requireSession(context, sessionId);
    return this.ctx.storage.listMessages(sessionId);
  }

  async append(context: AgentRequestContext, sessionId: string, message: { role: "user" | "assistant" | "system"; content: string }) {
    await this.requireSession(context, sessionId);
    return this.ctx.storage.appendMessage(sessionId, message);
  }

  private async requireSession(context: AgentRequestContext, sessionId: string) {
    const session = await this.ctx.storage.getSession(ownerKey(context), sessionId);
    if (!session) throw new Error("Agent session not found");
    return session;
  }
}

function ownerKey(context: AgentRequestContext) {
  return [context.identity.tenantId ?? "default", context.identity.userId, context.route ?? "general"].join(":");
}
