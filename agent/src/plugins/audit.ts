import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentAudit, AgentRequestContext } from "../contracts.js";

export class AuditService extends Service implements AgentAudit {
  static inject = ["storage"];
  constructor(ctx: Context) {
    super(ctx, "audit");
    ctx.on("agent/event", (event, context) => {
      if (!context.runId || !["tool.started", "tool.completed", "run.paused", "run.completed", "run.failed"].includes(event.type)) return;
      void this.record(context, `stream.${event.type}`, event);
    });
    ctx.on("agent/run-state", ({ runId, status, sessionId }) => {
      void ctx.storage.appendRunStep({ id: `audit_${randomUUID()}`, runId, index: -1, kind: "system", name: "run.state", input: { sessionId, status }, status: "completed", createdAt: new Date().toISOString() });
    });
  }
  async record(context: AgentRequestContext, event: string, payload: unknown) {
    if (!context.runId) return;
    await this.ctx.storage.appendRunStep({ id: `audit_${randomUUID()}`, runId: context.runId, index: -1, kind: "system", name: event, input: payload, status: "completed", createdAt: new Date().toISOString() });
  }
}
