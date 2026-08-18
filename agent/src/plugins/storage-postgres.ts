import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentMemory, AgentMessage, AgentRun, AgentRunStep, AgentSession, AgentStorage, WorkflowCheckpoint } from "../contracts.js";

export function createPostgresStorage(connectionString: string) {
  return class PostgresStorage extends Service implements AgentStorage {
    private readonly pool = new Pool({ connectionString, max: Number(process.env.AGENT_POSTGRES_POOL_SIZE ?? "10") });
    private readonly ready: Promise<void>;

    constructor(ctx: Context) {
      super(ctx, "storage");
      this.ready = this.migrate();
    }

    async listSessions(ownerKey: string) { await this.ready; return rows<AgentSession>(this.pool, "select id, owner_key as \"ownerKey\", title, created_at as \"createdAt\", updated_at as \"updatedAt\" from agent_runtime_sessions where owner_key = $1 order by updated_at desc", [ownerKey]); }
    async createSession(ownerKey: string, title = "新对话", id = `as_${randomUUID()}`) {
      await this.ready;
      const result = await rows<AgentSession>(this.pool, "insert into agent_runtime_sessions (id, owner_key, title) values ($1, $2, $3) returning id, owner_key as \"ownerKey\", title, created_at as \"createdAt\", updated_at as \"updatedAt\"", [id, ownerKey, title]);
      return result[0];
    }
    async getSession(ownerKey: string, sessionId: string) { await this.ready; return (await rows<AgentSession>(this.pool, "select id, owner_key as \"ownerKey\", title, created_at as \"createdAt\", updated_at as \"updatedAt\" from agent_runtime_sessions where id = $1 and owner_key = $2", [sessionId, ownerKey]))[0]; }
    async updateSession(ownerKey: string, sessionId: string, patch: Pick<AgentSession, "title">) { await this.ready; return (await rows<AgentSession>(this.pool, "update agent_runtime_sessions set title = $3, updated_at = now() where id = $1 and owner_key = $2 returning id, owner_key as \"ownerKey\", title, created_at as \"createdAt\", updated_at as \"updatedAt\"", [sessionId, ownerKey, patch.title]))[0]; }
    async deleteSession(ownerKey: string, sessionId: string) { await this.ready; const result = await this.pool.query("delete from agent_runtime_sessions where id = $1 and owner_key = $2", [sessionId, ownerKey]); return (result.rowCount ?? 0) > 0; }
    async listMessages(sessionId: string) { await this.ready; return rows<AgentMessage>(this.pool, "select id, role, content, created_at as \"createdAt\" from agent_runtime_messages where session_id = $1 order by created_at", [sessionId]); }
    async appendMessage(sessionId: string, message: Omit<AgentMessage, "id" | "createdAt">) {
      await this.ready;
      const id = `am_${randomUUID()}`;
      const result = await rows<AgentMessage>(this.pool, "insert into agent_runtime_messages (id, session_id, role, content) values ($1, $2, $3, $4) returning id, role, content, created_at as \"createdAt\"", [id, sessionId, message.role, message.content]);
      await this.pool.query("update agent_runtime_sessions set updated_at = now() where id = $1", [sessionId]);
      return result[0];
    }
    async createRun(run: AgentRun) { await this.ready; await this.pool.query("insert into agent_runtime_runs (id, session_id, owner_key, status, started_at, input_tokens, output_tokens) values ($1,$2,$3,$4,$5,$6,$7)", [run.id, run.sessionId, run.ownerKey, run.status, run.startedAt, run.inputTokens, run.outputTokens]); }
    async updateRun(runId: string, patch: Partial<Pick<AgentRun, "status" | "completedAt" | "inputTokens" | "outputTokens" | "errorMessage">>) { await this.ready; await this.pool.query("update agent_runtime_runs set status = coalesce($2,status), completed_at = coalesce($3,completed_at), input_tokens = coalesce($4,input_tokens), output_tokens = coalesce($5,output_tokens), error_message = coalesce($6,error_message) where id = $1", [runId, patch.status ?? null, patch.completedAt ?? null, patch.inputTokens ?? null, patch.outputTokens ?? null, patch.errorMessage ?? null]); }
    async appendRunStep(step: AgentRunStep) { await this.ready; await this.pool.query("insert into agent_runtime_run_steps (id, run_id, step_index, kind, name, input_json, output_json, status, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [step.id, step.runId, step.index, step.kind, step.name, step.input, step.output ?? null, step.status, step.createdAt]); }
    async saveCheckpoint(checkpoint: WorkflowCheckpoint) {
      await this.ready;
      await this.pool.query("insert into agent_runtime_checkpoints (pending_action_id, session_id, run_json, messages_json, iteration, created_at) values ($1,$2,$3,$4,$5,$6) on conflict (pending_action_id) do update set session_id = excluded.session_id, run_json = excluded.run_json, messages_json = excluded.messages_json, iteration = excluded.iteration, created_at = excluded.created_at", [checkpoint.pendingActionId, checkpoint.run.sessionId, checkpoint.run, checkpoint.messages, checkpoint.iteration, checkpoint.createdAt]);
    }
    async getCheckpoint(sessionId: string, actionId: string) {
      await this.ready;
      const result = await this.pool.query<{ run: AgentRun; messages: AgentMessage[]; iteration: number; pendingActionId: string; createdAt: string }>("select run_json as run, messages_json as messages, iteration, pending_action_id as \"pendingActionId\", created_at as \"createdAt\" from agent_runtime_checkpoints where session_id = $1 and pending_action_id = $2", [sessionId, actionId]);
      const row = result.rows[0];
      return row ? { run: row.run, messages: row.messages, iteration: row.iteration, pendingActionId: row.pendingActionId, createdAt: row.createdAt } : undefined;
    }
    async deleteCheckpoint(sessionId: string, actionId: string) { await this.ready; await this.pool.query("delete from agent_runtime_checkpoints where session_id = $1 and pending_action_id = $2", [sessionId, actionId]); }
    async recordMemory(memory: AgentMemory) { await this.ready; await this.pool.query("insert into agent_runtime_memories (id, owner_key, content, category, embedding_model, embedding_version, embedding, expires_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [memory.id, memory.ownerKey, memory.content, memory.category, memory.embeddingModel, memory.embeddingVersion, memory.embedding ?? null, memory.expiresAt ?? null, memory.createdAt]); }
    async searchMemory(ownerKey: string, query: string, limit: number, embedding?: number[]) {
      await this.ready;
      if (embedding?.length) return rows<AgentMemory>(this.pool, "select id, owner_key as \"ownerKey\", content, category, embedding_model as \"embeddingModel\", embedding_version as \"embeddingVersion\", embedding, expires_at as \"expiresAt\", created_at as \"createdAt\" from agent_runtime_memories where owner_key = $1 and (expires_at is null or expires_at > now()) order by coalesce((select sum(a * b) / nullif(sqrt(sum(a * a)) * sqrt(sum(b * b)), 0) from unnest(embedding, $2::float8[]) as vector(a, b)), -1) desc limit $3", [ownerKey, embedding, limit]);
      return rows<AgentMemory>(this.pool, "select id, owner_key as \"ownerKey\", content, category, embedding_model as \"embeddingModel\", embedding_version as \"embeddingVersion\", embedding, expires_at as \"expiresAt\", created_at as \"createdAt\" from agent_runtime_memories where owner_key = $1 and (expires_at is null or expires_at > now()) and content ilike $2 order by created_at desc limit $3", [ownerKey, `%${query.split(/\s+/)[0] ?? ""}%`, limit]);
    }
    async deleteMemory(ownerKey: string) { await this.ready; const result = await this.pool.query("delete from agent_runtime_memories where owner_key = $1", [ownerKey]); return result.rowCount ?? 0; }
    private async migrate() {
      await this.pool.query(`
        create table if not exists agent_runtime_sessions (id text primary key, owner_key text not null, title text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
        create index if not exists agent_runtime_sessions_owner_updated on agent_runtime_sessions (owner_key, updated_at desc);
        create table if not exists agent_runtime_messages (id text primary key, session_id text not null references agent_runtime_sessions(id) on delete cascade, role text not null, content text not null, created_at timestamptz not null default now());
        create index if not exists agent_runtime_messages_session_created on agent_runtime_messages (session_id, created_at);
        create table if not exists agent_runtime_runs (id text primary key, session_id text not null references agent_runtime_sessions(id) on delete cascade, owner_key text not null, status text not null, started_at timestamptz not null, completed_at timestamptz, input_tokens integer not null default 0, output_tokens integer not null default 0, error_message text);
        create index if not exists agent_runtime_runs_session_started on agent_runtime_runs (session_id, started_at desc);
        create table if not exists agent_runtime_run_steps (id text primary key, run_id text not null references agent_runtime_runs(id) on delete cascade, step_index integer not null, kind text not null, name text not null, input_json jsonb not null, output_json jsonb, status text not null, created_at timestamptz not null);
        create index if not exists agent_runtime_steps_run_index on agent_runtime_run_steps (run_id, step_index);
        create table if not exists agent_runtime_checkpoints (pending_action_id text primary key, session_id text not null references agent_runtime_sessions(id) on delete cascade, run_json jsonb not null, messages_json jsonb not null, iteration integer not null, created_at timestamptz not null);
        create index if not exists agent_runtime_checkpoints_session on agent_runtime_checkpoints (session_id);
        create table if not exists agent_runtime_memories (id text primary key, owner_key text not null, content text not null, category text not null, embedding_model text not null, embedding_version text not null, embedding double precision[], expires_at timestamptz, created_at timestamptz not null);
        alter table agent_runtime_memories add column if not exists embedding double precision[];
        create index if not exists agent_runtime_memories_owner_created on agent_runtime_memories (owner_key, created_at desc);
      `);
    }
  };
}

async function rows<T>(pool: Pool, text: string, values: unknown[]) {
  return (await pool.query(text, values)).rows as T[];
}
