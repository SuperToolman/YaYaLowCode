import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentMessage, AgentRequestContext, AgentRun, AgentStreamEvent, PendingAction, ToolDefinition, WorkflowEngine } from "../contracts.js";
import { PendingActionError } from "./policy.js";

type WorkerResult = { content: string; tool_calls: Array<{ id: string; name: string; input: unknown }>; input_tokens: number; output_tokens: number };

export function createLangGraphWorkflowClient(baseUrl: string, internalToken: string) {
  return class LangGraphWorkflowClient extends Service implements WorkflowEngine {
    static inject = ["sessions", "tools", "storage", "memory", "audit", "skills"];
    constructor(ctx: Context) { super(ctx, "workflow"); }
    async *run(sessionId: string, prompt: string, context: AgentRequestContext): AsyncIterable<AgentStreamEvent> {
      const run: AgentRun = { id: `run_${randomUUID()}`, sessionId, ownerKey: ownerKey(context), status: "running", startedAt: new Date().toISOString(), inputTokens: 0, outputTokens: 0 };
      context.sessionId = sessionId; context.runId = run.id;
      try {
        await this.ctx.storage.createRun(run);
        await this.ctx.sessions.append(context, sessionId, { role: "user", content: prompt });
        let messages = await this.ctx.sessions.messages(context, sessionId);
        const skillInstructions = this.ctx.skills.instructions(context);
        if (skillInstructions) messages = [{ id: "skills", role: "system", content: skillInstructions, createdAt: new Date().toISOString() }, ...messages];
        const memory = await this.ctx.memory.retrieve(context, prompt);
        if (memory.length) messages = [{ id: "memory", role: "system", content: memory.map((item) => item.content).join("\n"), createdAt: new Date().toISOString() }, ...messages];
        const maxIterations = Number(process.env.AGENT_MAX_TOOL_ITERATIONS ?? "8");
        const maxTokens = Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "16000");
        for (let index = 0; index <= maxIterations; index++) {
          const result = await invokeWorker(baseUrl, internalToken, run.id, sessionId, messages, this.ctx.tools.list(), context.abortSignal, maxTokens, context);
          run.inputTokens += result.input_tokens; run.outputTokens += result.output_tokens;
          if (run.inputTokens + run.outputTokens > maxTokens) throw new Error("Agent token budget exceeded");
          await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "model", name: "langgraph.model", input: { messageCount: messages.length }, output: result, status: "completed", createdAt: new Date().toISOString() });
          if (!result.tool_calls.length) {
            const message = await this.ctx.sessions.append(context, sessionId, { role: "assistant", content: result.content || "Agent 没有生成可显示的回答。" });
            if (result.content) yield { type: "message.delta", delta: result.content };
            await this.ctx.storage.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens });
            yield { type: "message.completed", message: { id: message.id, runId: run.id } }; yield { type: "run.completed" }; return;
          }
          for (const call of result.tool_calls) {
            yield { type: "tool.started", name: call.name };
            try {
              const output = await this.ctx.tools.execute(call.name, call.input, context);
              await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "tool", name: call.name, input: call.input, output, status: "completed", createdAt: new Date().toISOString() });
              yield { type: "tool.completed", name: call.name, result: output };
              messages = [...messages, { id: `tool_${call.id}`, role: "system", content: `Tool ${call.name} result: ${JSON.stringify(output)}`, createdAt: new Date().toISOString() }];
            } catch (error) {
              if (error instanceof PendingActionError) {
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
        throw new Error("Agent exceeded its tool-iteration limit");
      } catch (error) {
        await this.ctx.storage.updateRun(run.id, { status: context.abortSignal?.aborted ? "cancelled" : "failed", completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens, errorMessage: error instanceof Error ? error.message : "LangGraph run failed" }).catch(() => undefined);
        yield { type: "run.failed", message: error instanceof Error ? error.message : "LangGraph run failed" };
      } finally { delete context.runId; }
    }
    async resume(sessionId: string, action: PendingAction, result: unknown, context: AgentRequestContext): Promise<AgentMessage> {
      const checkpoint = await this.ctx.storage.getCheckpoint(sessionId, action.id);
      if (!checkpoint) throw new Error("Workflow checkpoint not found or already resumed");
      const run = checkpoint.run;
      context.sessionId = sessionId;
      context.runId = run.id;
      let messages = [...checkpoint.messages, { id: `tool_${action.id}`, role: "system" as const, content: `Tool ${action.actionType} approved result: ${JSON.stringify(result)}`, createdAt: new Date().toISOString() }];
      const maxIterations = Number(process.env.AGENT_MAX_TOOL_ITERATIONS ?? "8");
      const maxTokens = Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "16000");
      try {
        for (let index = checkpoint.iteration; index <= maxIterations; index++) {
          const worker = await invokeWorker(baseUrl, internalToken, run.id, sessionId, messages, this.ctx.tools.list(), context.abortSignal, maxTokens, context);
          run.inputTokens += worker.input_tokens;
          run.outputTokens += worker.output_tokens;
          await this.ctx.storage.appendRunStep({ id: `step_${randomUUID()}`, runId: run.id, index, kind: "model", name: "langgraph.model.resume", input: { messageCount: messages.length }, output: worker, status: "completed", createdAt: new Date().toISOString() });
          if (run.inputTokens + run.outputTokens > maxTokens) throw new Error("Agent token budget exceeded");
          if (!worker.tool_calls.length) {
            const message = await this.ctx.sessions.append(context, sessionId, { role: "assistant", content: worker.content || "审批已完成。" });
            await this.ctx.storage.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString(), inputTokens: run.inputTokens, outputTokens: run.outputTokens });
            await this.ctx.storage.deleteCheckpoint(sessionId, action.id);
            this.ctx.emit("agent/run-state", { runId: run.id, status: "completed", sessionId });
            return message;
          }
          for (const call of worker.tool_calls) {
            try {
              const output = await this.ctx.tools.execute(call.name, call.input, context);
              messages = [...messages, { id: `tool_${call.id}`, role: "system", content: `Tool ${call.name} result: ${JSON.stringify(output)}`, createdAt: new Date().toISOString() }];
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
        throw new Error("Agent exceeded its tool-iteration limit");
      } finally { delete context.runId; }
    }
  };
}

async function invokeWorker(baseUrl: string, token: string, runId: string, sessionId: string, messages: AgentMessage[], tools: ToolDefinition[], signal?: AbortSignal, maxTokens = 16000, context?: AgentRequestContext): Promise<WorkerResult> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/invoke`, { method: "POST", signal, headers: { "content-type": "application/json", "x-agent-internal-token": token }, body: JSON.stringify({ run_id: runId, session_id: sessionId, max_tokens: maxTokens, context: context ? { request_id: context.requestId, tenant_id: context.identity.tenantId, user_id: context.identity.userId, route: context.route } : undefined, messages: messages.map(({ role, content }) => ({ role, content })), tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: "object" } } })) }) });
  if (!response.ok) throw new Error(`LangGraph worker request failed (${response.status})`);
  return response.json() as Promise<WorkerResult>;
}
function ownerKey(context: AgentRequestContext) { return [context.identity.tenantId ?? "default", context.identity.userId, context.route ?? "general"].join(":"); }
