import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentRequestContext, AgentTools, ToolDefinition } from "../contracts.js";

export class ToolService extends Service implements AgentTools {
  static inject = ["policy"];
  private readonly registry = new Map<string, ToolDefinition>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  register(tool: ToolDefinition) {
    if (this.registry.has(tool.name)) throw new Error(`Tool ${tool.name} is already registered`);
    this.registry.set(tool.name, tool);
    return () => this.registry.delete(tool.name);
  }

  list() {
    return [...this.registry.values()];
  }

  async execute(name: string, input: unknown, context: AgentRequestContext) {
    const tool = this.registry.get(name);
    if (!tool) throw new Error(`Tool ${name} is not registered`);
    await this.ctx.policy.authorize(tool, input, context);
    return this.ctx.waterfall("tool/before-execute", tool, input, context, () => tool.execute(input, context));
  }
}
