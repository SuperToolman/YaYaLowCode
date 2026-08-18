import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentMemory, AgentMessage, AgentRun, AgentRunStep, AgentSession, AgentStorage, WorkflowCheckpoint } from "../contracts.js";

type Store = {
  sessions: AgentSession[];
  messages: Record<string, AgentMessage[]>;
  runs: AgentRun[];
  steps: AgentRunStep[];
  memories: AgentMemory[];
  checkpoints: WorkflowCheckpoint[];
};

export function createJsonStorage(path: string) {
  return class JsonStorage extends Service implements AgentStorage {
    private store: Store = { sessions: [], messages: {}, runs: [], steps: [], memories: [], checkpoints: [] };
    private ready: Promise<void>;

    constructor(ctx: Context) {
      super(ctx, "storage");
      this.ready = this.load(path);
    }

    async listSessions(ownerKey: string) {
      await this.ready;
      return this.store.sessions.filter((session) => session.ownerKey === ownerKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async createSession(ownerKey: string, title = "新对话", id?: string) {
      await this.ready;
      const now = new Date().toISOString();
      const session: AgentSession = { id: id ?? `as_${randomUUID()}`, ownerKey, title, createdAt: now, updatedAt: now };
      this.store.sessions.push(session);
      await this.flush(path);
      return session;
    }

    async getSession(ownerKey: string, sessionId: string) {
      await this.ready;
      return this.store.sessions.find((session) => session.id === sessionId && session.ownerKey === ownerKey);
    }

    async updateSession(ownerKey: string, sessionId: string, patch: Pick<AgentSession, "title">) {
      await this.ready;
      const session = await this.getSession(ownerKey, sessionId);
      if (!session) return undefined;
      session.title = patch.title;
      session.updatedAt = new Date().toISOString();
      await this.flush(path);
      return session;
    }

    async deleteSession(ownerKey: string, sessionId: string) {
      await this.ready;
      const session = await this.getSession(ownerKey, sessionId);
      if (!session) return false;
      this.store.sessions = this.store.sessions.filter((item) => item.id !== sessionId);
      delete this.store.messages[sessionId];
      this.store.runs = this.store.runs.filter((item) => item.sessionId !== sessionId);
      this.store.checkpoints = this.store.checkpoints.filter((item) => item.run.sessionId !== sessionId);
      await this.flush(path);
      return true;
    }

    async listMessages(sessionId: string) {
      await this.ready;
      return this.store.messages[sessionId] ?? [];
    }

    async appendMessage(sessionId: string, value: Omit<AgentMessage, "id" | "createdAt">) {
      await this.ready;
      const message: AgentMessage = { ...value, id: `am_${randomUUID()}`, createdAt: new Date().toISOString() };
      this.store.messages[sessionId] ??= [];
      this.store.messages[sessionId].push(message);
      const session = this.store.sessions.find((item) => item.id === sessionId);
      if (session) session.updatedAt = message.createdAt;
      await this.flush(path);
      return message;
    }

    async createRun(run: AgentRun) { await this.ready; this.store.runs.push(run); await this.flush(path); }
    async updateRun(runId: string, patch: Partial<Pick<AgentRun, "status" | "completedAt" | "inputTokens" | "outputTokens" | "errorMessage">>) {
      await this.ready;
      const run = this.store.runs.find((item) => item.id === runId);
      if (!run) throw new Error("Agent run not found");
      Object.assign(run, patch);
      await this.flush(path);
    }
    async appendRunStep(step: AgentRunStep) { await this.ready; this.store.steps.push(step); await this.flush(path); }
    async saveCheckpoint(checkpoint: WorkflowCheckpoint) {
      await this.ready;
      this.store.checkpoints = this.store.checkpoints.filter((item) => item.pendingActionId !== checkpoint.pendingActionId);
      this.store.checkpoints.push(checkpoint);
      await this.flush(path);
    }
    async getCheckpoint(sessionId: string, actionId: string) {
      await this.ready;
      return this.store.checkpoints.find((item) => item.run.sessionId === sessionId && item.pendingActionId === actionId);
    }
    async deleteCheckpoint(sessionId: string, actionId: string) {
      await this.ready;
      this.store.checkpoints = this.store.checkpoints.filter((item) => item.run.sessionId !== sessionId || item.pendingActionId !== actionId);
      await this.flush(path);
    }
    async recordMemory(memory: AgentMemory) { await this.ready; this.store.memories.push(memory); await this.flush(path); }
    async searchMemory(ownerKey: string, query: string, limit: number, embedding?: number[]) {
      await this.ready;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const now = new Date().toISOString();
      return this.store.memories
        .filter((item) => item.ownerKey === ownerKey && (!item.expiresAt || item.expiresAt > now))
        .sort((left, right) => score(right, words, embedding) - score(left, words, embedding))
        .slice(0, limit);
    }
    async deleteMemory(ownerKey: string) {
      await this.ready;
      const before = this.store.memories.length;
      this.store.memories = this.store.memories.filter((item) => item.ownerKey !== ownerKey);
      await this.flush(path);
      return before - this.store.memories.length;
    }

    private async load(storePath: string) {
      try {
        this.store = { ...this.store, ...JSON.parse(await readFile(storePath, "utf8")) as Store };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(dirname(storePath), { recursive: true });
      }
    }

    private async flush(storePath: string) {
      const temporary = `${storePath}.tmp`;
      await mkdir(dirname(storePath), { recursive: true });
      await writeFile(temporary, JSON.stringify(this.store), "utf8");
      await rename(temporary, storePath);
    }
  };
}

function score(memory: AgentMemory, words: string[], embedding?: number[]) {
  const content = memory.content.toLowerCase();
  const lexical = words.reduce((total, word) => total + Number(content.includes(word)), 0);
  if (!embedding || !memory.embedding?.length || memory.embedding.length !== embedding.length) return lexical;
  const dot = embedding.reduce((total, value, index) => total + value * memory.embedding![index], 0);
  const norm = Math.sqrt(embedding.reduce((total, value) => total + value * value, 0) * memory.embedding.reduce((total, value) => total + value * value, 0));
  return lexical + (norm ? dot / norm : 0);
}
