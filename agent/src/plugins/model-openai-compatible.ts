import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentMessage, ToolDefinition } from "../contracts.js";

export interface ChatModel {
  complete(messages: AgentMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; input: unknown }>; usage: { inputTokens: number; outputTokens: number } }>;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    model: ChatModel;
  }
}

export function createOpenAiCompatibleModel() {
  return class OpenAiCompatibleModel extends Service implements ChatModel {
    constructor(ctx: Context) {
      super(ctx, "model");
    }

    async complete(messages: AgentMessage[], tools: ToolDefinition[], signal?: AbortSignal) {
      const baseUrl = process.env.AGENT_MODEL_BASE_URL?.replace(/\/$/, "");
      const apiKey = process.env.AGENT_MODEL_API_KEY;
      const model = process.env.AGENT_MODEL_NAME;
      if (!baseUrl || !apiKey || !model) {
        throw new Error("AGENT_MODEL_BASE_URL, AGENT_MODEL_API_KEY and AGENT_MODEL_NAME are required");
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        signal,
        body: JSON.stringify({
          model,
          stream: false,
          messages: messages.map(({ role, content }) => ({ role, content })),
          tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: "object", additionalProperties: true } } })),
          tool_choice: tools.length ? "auto" : "none",
        }),
      });
      if (!response.ok) throw new Error(`Model request failed (${response.status})`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const message = payload.choices?.[0]?.message;
      return {
        content: message?.content ?? "",
        toolCalls: (message?.tool_calls ?? []).flatMap((call) => {
          if (!call.function?.name) return [];
          try { return [{ id: call.id ?? call.function.name, name: call.function.name, input: JSON.parse(call.function.arguments ?? "{}") }]; } catch { throw new Error(`Model returned invalid arguments for ${call.function.name}`); }
        }),
        usage: { inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0 },
      };
    }
  };
}
