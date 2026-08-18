import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentMessage, AgentRequestContext, AgentRun, AgentStreamEvent, PendingAction, WorkflowEngine } from "../contracts.js";
import { PendingActionError } from "./policy.js";

export class LoopService extends Service implements WorkflowEngine {
  static inject = ["model", "sessions", "tools", "memory", "audit", "storage", "skills"];
  constructor(ctx: Context) { super(ctx, "workflow"); }

  async *run(sessionId: string, prompt: string, context: AgentRequestContext): AsyncIterable<AgentStreamEvent> {
    const run: AgentRun = { id: `run_${randomUUID()}`, sessionId, ownerKey: ownerKey(context), status: "running", startedAt: new Date().toISOString(), inputTokens: 0, outputTokens: 0 };
    context.sessionId = sessionId;
    context.runId = run.id;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Agent run timed out")), Number(process.env.AGENT_RUN_TIMEOUT_MS ?? "120000"));
    const onClose = () => controller.abort(new Error("Client disconnected"));
    context.abortSignal?.addEventListener("abort", onClose, { once: true });
    try {
      await this.ctx.storage.createRun(run);
      this.ctx.waterfall("agent/before-run", { sessionId, prompt, context }, () => undefined);
      await this.ctx.sessions.append(context, sessionId, { role: "user", content: prompt });
      const memories = await this.ctx.memory.retrieve(context, prompt);
      let messages = await this.ctx.sessions.messages(context, sessionId);
      const skillInstructions = this.ctx.skills.instructions(context);
      if (skillInstructions) messages = [{ id: "skills", role: "system", content: skillInstructions, createdAt: new Date().toISOString() }, ...messages];
      if (memories.length) messages = [{ id: "memory", role: "system", content: `Relevant durable memory:\n${memories.map((memory) => `- ${memory.content}`).join("\n")}`, createdAt: new Date().toISOString() }, ...messages];
      const maxIterations = Number(process.env.AGENT_MAX_TOOL_ITERATIONS ?? "8");
      const maxTokens = Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "16000");
      for (let index = 0; index <= maxIterations; index++) {
        if (controller.signal.aborted) throw controller.signal.reason;
        await this.ctx.audit.record(context, "model.requested", { iteration: index });
        const result = await this.ctx.model.complete(messages, this.ctx.tools.list(), controller.signal);
        run.inputTokens += result.usage.inputTokens;
        run.outputTokens += result.usage.outputTokens;
        await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "model", name: "chat.completion", input: { messageCount: messages.length }, output: { toolCalls: result.toolCalls.map((call) => call.name), usage: result.usage }, status: "completed", createdAt: new Date().toISOString() });
        if (run.inputTokens + run.outputTokens > maxTokens) throw new BudgetExceededError();
        if (!result.toolCalls.length) {
          const message = await this.ctx.sessions.append(context, sessionId, { role: "assistant", content: result.content || "Agent 没有生成可显示的回答。" });
          if (result.content) yield { type: "message.delta", delta: result.content };
          await this.ctx.storage.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens });
          yield { type: "message.completed", message: { id: message.id, runId: run.id } };
          yield { type: "run.completed" };
          return;
        }
        for (const call of result.toolCalls) {
          const started = { type: "tool.started", name: call.name } as const;
          yield started;
          try {
            const output = await this.ctx.tools.execute(call.name, call.input, context);
            await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "tool", name: call.name, input: call.input, output, status: "completed", createdAt: new Date().toISOString() });
            yield { type: "tool.completed", name: call.name, result: output };
            messages = [...messages, { id: `tool_${call.id}`, role: "system", content: `Tool ${call.name} result: ${JSON.stringify(output)}`, createdAt: new Date().toISOString() }];
          } catch (error) {
            if (error instanceof PendingActionError) {
              await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "approval", name: call.name, input: call.input, output: { actionId: error.action.id }, status: "paused", createdAt: new Date().toISOString() });
              await this.ctx.storage.updateRun(run.id, { status: "paused", inputTokens: run.inputTokens, outputTokens: run.outputTokens });
              await this.ctx.storage.saveCheckpoint({ run: { ...run, status: "paused" }, messages, iteration: index, pendingActionId: error.action.id, createdAt: new Date().toISOString() });
              this.ctx.emit("agent/run-state", { runId: run.id, status: "paused", sessionId });
              yield { type: "run.paused", action: error.action };
              return;
            }
            throw error;
          }
        }
      }
      throw new Error(`Agent exceeded ${maxIterations} tool iterations`);
    } catch (error) {
      const status = controller.signal.aborted
        ? (String(controller.signal.reason).includes("timed out") ? "timed_out" : "cancelled")
        : error instanceof BudgetExceededError ? "budget_exceeded" : "failed";
      await this.ctx.storage.updateRun(run.id, { status, completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens, errorMessage: error instanceof Error ? error.message : "Agent run failed" }).catch(() => undefined);
      yield { type: "run.failed", message: error instanceof Error ? error.message : "Agent run failed" };
    } finally {
      clearTimeout(timeout);
      context.abortSignal?.removeEventListener("abort", onClose);
      delete context.runId;
    }
  }

  async resume(sessionId: string, action: PendingAction, result: unknown, context: AgentRequestContext): Promise<AgentMessage> {
    context.sessionId = sessionId;
    const checkpoint = await this.ctx.storage.getCheckpoint(sessionId, action.id);
    if (!checkpoint) throw new Error("Workflow checkpoint not found or already resumed");
    const run = checkpoint.run;
    context.runId = run.id;
    const messages = [...checkpoint.messages, { id: `tool_${action.id}`, role: "system" as const, content: `Tool ${action.actionType} approved result: ${JSON.stringify(result)}`, createdAt: new Date().toISOString() }];
    const maxIterations = Number(process.env.AGENT_MAX_TOOL_ITERATIONS ?? "8");
    const maxTokens = Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "16000");
    try {
      for (let index = checkpoint.iteration; index <= maxIterations; index++) {
        const model = await this.ctx.model.complete(messages, this.ctx.tools.list(), context.abortSignal);
        run.inputTokens += model.usage.inputTokens;
        run.outputTokens += model.usage.outputTokens;
        await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "model", name: "chat.completion.resume", input: { messageCount: messages.length }, output: { toolCalls: model.toolCalls.map((call) => call.name), usage: model.usage }, status: "completed", createdAt: new Date().toISOString() });
        if (run.inputTokens + run.outputTokens > maxTokens) throw new BudgetExceededError();
        if (!model.toolCalls.length) {
          const message = await this.ctx.sessions.append(context, sessionId, { role: "assistant", content: model.content || "审批已完成。" });
          await this.ctx.storage.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens });
          await this.ctx.storage.deleteCheckpoint(sessionId, action.id);
          this.ctx.emit("agent/run-state", { runId: run.id, status: "completed", sessionId });
          return message;
        }
        for (const call of model.toolCalls) {
          try {
            const output = await this.ctx.tools.execute(call.name, call.input, context);
            messages.push({ id: `tool_${call.id}`, role: "system", content: `Tool ${call.name} result: ${JSON.stringify(output)}`, createdAt: new Date().toISOString() });
            await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "tool", name: call.name, input: call.input, output, status: "completed", createdAt: new Date().toISOString() });
          } catch (error) {
            if (error instanceof PendingActionError) {
              await this.ctx.storage.saveCheckpoint({ run: { ...run, status: "paused" }, messages, iteration: index, pendingActionId: error.action.id, createdAt: new Date().toISOString() });
              await this.ctx.storage.updateRun(run.id, { status: "paused", inputTokens: run.inputTokens, outputTokens: run.outputTokens });
              return this.ctx.sessions.append(context, sessionId, { role: "assistant", content: JSON.stringify({ type: "approval.required", actionId: error.action.id, actionType: error.action.actionType }) });
            }
            throw error;
          }
        }
      }
      throw new Error(`Agent exceeded ${maxIterations} tool iterations`);
    } catch (error) {
      await this.ctx.storage.updateRun(run.id, { status: error instanceof BudgetExceededError ? "budget_exceeded" : "failed", completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens, errorMessage: error instanceof Error ? error.message : "Agent resume failed" });
      throw error;
    } finally {
      delete context.runId;
    }
  }
}

class BudgetExceededError extends Error { constructor() { super("Agent token budget exceeded"); } }
function ownerKey(context: AgentRequestContext) { return [context.identity.tenantId ?? "default", context.identity.userId, context.route ?? "general"].join(":"); }
