import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentPolicy, AgentRequestContext, ToolDefinition } from "../contracts.js";

export class PolicyService extends Service implements AgentPolicy {
  static inject = ["platform"];

  constructor(ctx: Context) {
    super(ctx, "policy");
  }

  async authorize(tool: ToolDefinition, input: unknown, context: AgentRequestContext) {
    if (!context.authorization.startsWith("Bearer ")) throw new Error("Platform authorization is required");
    if (tool.requiresApproval) {
      if (!context.sessionId) throw new Error("A session is required for approval-gated tools");
      const action = await this.ctx.platform.createPendingAction(context, {
        sessionId: context.sessionId,
        actionType: tool.name,
        payload: input,
        summary: `Agent 请求执行工具 ${tool.name}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      throw new PendingActionError(action);
    }
  }
}

export class PendingActionError extends Error {
  constructor(readonly action: Awaited<ReturnType<import("../contracts.js").PlatformClient["listPendingActions"]>>[number]) {
    super(`Tool approval is required for ${action.actionType}`);
  }
}
