import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentMemory, AgentMemoryService, AgentRequestContext } from "../contracts.js";

export class MemoryService extends Service implements AgentMemoryService {
  static inject = ["storage"];
  constructor(ctx: Context) { super(ctx, "memory"); }
  async retrieve(context: AgentRequestContext, query: string, limit = 5) {
    return this.ctx.storage.searchMemory(ownerKey(context), query, Math.min(Math.max(limit, 1), 20), await embed(query));
  }
  async record(context: AgentRequestContext, content: string, category: AgentMemory["category"] = "fact") {
    const sanitized = redactPii(content).trim();
    if (!sanitized || sanitized.length > Number(process.env.AGENT_MEMORY_MAX_CHARS ?? "1000")) return undefined;
    const retentionDays = Number(process.env.AGENT_MEMORY_RETENTION_DAYS ?? "90");
    const memory: AgentMemory = {
      id: `mem_${randomUUID()}`,
      ownerKey: ownerKey(context),
      content: sanitized,
      category,
      embeddingModel: process.env.AGENT_EMBEDDING_MODEL ?? "none",
      embeddingVersion: process.env.AGENT_EMBEDDING_VERSION ?? "v1",
      embedding: await embed(sanitized),
      expiresAt: retentionDays > 0 ? new Date(Date.now() + retentionDays * 86400000).toISOString() : undefined,
      createdAt: new Date().toISOString(),
    };
    await this.ctx.storage.recordMemory(memory);
    return memory;
  }
  forget(context: AgentRequestContext) { return this.ctx.storage.deleteMemory(ownerKey(context)); }
}

async function embed(input: string): Promise<number[] | undefined> {
  const baseUrl = process.env.AGENT_EMBEDDING_BASE_URL ?? process.env.AGENT_MODEL_BASE_URL;
  const apiKey = process.env.AGENT_EMBEDDING_API_KEY ?? process.env.AGENT_MODEL_API_KEY;
  const model = process.env.AGENT_EMBEDDING_MODEL;
  if (!baseUrl || !apiKey || !model || model === "none") return undefined;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, input }) });
  if (!response.ok) throw new Error(`Embedding request failed (${response.status})`);
  const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
  return body.data?.[0]?.embedding;
}

function ownerKey(context: AgentRequestContext) { return [context.identity.tenantId ?? "default", context.identity.userId, context.route ?? "general"].join(":"); }
function redactPii(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b1\d{10}\b/g, "[redacted-phone]")
    .replace(/\b\d{17}[\dXx]\b/g, "[redacted-id]");
}
