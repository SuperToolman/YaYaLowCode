import type { Context } from "@deepseek-ai/cordis";

export type AgentRole = "user" | "assistant" | "system";

export type AgentMessage = {
  id: string;
  role: AgentRole;
  content: string;
  createdAt: string;
};

export type AgentRunStatus = "running" | "paused" | "completed" | "failed" | "cancelled" | "timed_out" | "budget_exceeded";

export type AgentRun = {
  id: string;
  sessionId: string;
  ownerKey: string;
  status: AgentRunStatus;
  startedAt: string;
  completedAt?: string;
  inputTokens: number;
  outputTokens: number;
  errorMessage?: string;
};

export type AgentRunStep = {
  id: string;
  runId: string;
  index: number;
  kind: "model" | "tool" | "approval" | "system";
  name: string;
  input: unknown;
  output?: unknown;
  status: "started" | "completed" | "failed" | "paused";
  createdAt: string;
};

export type WorkflowCheckpoint = {
  run: AgentRun;
  messages: AgentMessage[];
  iteration: number;
  pendingActionId: string;
  createdAt: string;
};

export type AgentMemory = {
  id: string;
  ownerKey: string;
  content: string;
  category: "preference" | "fact" | "summary";
  embeddingModel: string;
  embeddingVersion: string;
  embedding?: number[];
  expiresAt?: string;
  createdAt: string;
};

export type AgentSession = {
  id: string;
  ownerKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRequestContext = {
  authorization: string;
  requestId: string;
  identity: AgentIdentity;
  sessionId?: string;
  runId?: string;
  abortSignal?: AbortSignal;
  appId?: string;
  formUuid?: string;
  route?: string;
};

export type AgentIdentity = {
  userId: string;
  tenantId?: string;
  displayName?: string;
  grants: string[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  requiresApproval: boolean;
  execute(input: unknown, context: AgentRequestContext): Promise<unknown>;
};

export type PendingActionStatus = "pending" | "executing" | "completed" | "failed" | "cancelled" | "expired";

export type PendingAction = {
  id: string;
  sessionId: string;
  actionType: string;
  payload: unknown;
  summary: string;
  status: PendingActionStatus;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  errorMessage?: string;
};

export interface AgentStorage {
  listSessions(ownerKey: string): Promise<AgentSession[]>;
  createSession(ownerKey: string, title?: string, id?: string): Promise<AgentSession>;
  getSession(ownerKey: string, sessionId: string): Promise<AgentSession | undefined>;
  updateSession(ownerKey: string, sessionId: string, patch: Pick<AgentSession, "title">): Promise<AgentSession | undefined>;
  deleteSession(ownerKey: string, sessionId: string): Promise<boolean>;
  listMessages(sessionId: string): Promise<AgentMessage[]>;
  appendMessage(sessionId: string, message: Omit<AgentMessage, "id" | "createdAt">): Promise<AgentMessage>;
  createRun(run: AgentRun): Promise<void>;
  updateRun(runId: string, patch: Partial<Pick<AgentRun, "status" | "completedAt" | "inputTokens" | "outputTokens" | "errorMessage">>): Promise<void>;
  appendRunStep(step: AgentRunStep): Promise<void>;
  saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void>;
  getCheckpoint(sessionId: string, actionId: string): Promise<WorkflowCheckpoint | undefined>;
  deleteCheckpoint(sessionId: string, actionId: string): Promise<void>;
  recordMemory(memory: AgentMemory): Promise<void>;
  searchMemory(ownerKey: string, query: string, limit: number, embedding?: number[]): Promise<AgentMemory[]>;
  deleteMemory(ownerKey: string): Promise<number>;
}

export interface AgentSessions {
  list(context: AgentRequestContext): Promise<AgentSession[]>;
  create(context: AgentRequestContext, title?: string): Promise<AgentSession>;
  update(context: AgentRequestContext, sessionId: string, patch: Pick<AgentSession, "title">): Promise<AgentSession>;
  delete(context: AgentRequestContext, sessionId: string): Promise<void>;
  messages(context: AgentRequestContext, sessionId: string): Promise<AgentMessage[]>;
  append(context: AgentRequestContext, sessionId: string, message: Omit<AgentMessage, "id" | "createdAt">): Promise<AgentMessage>;
}

export interface PlatformClient {
  request<T>(context: AgentRequestContext, path: string, init?: RequestInit): Promise<T>;
  identity(authorization: string): Promise<AgentIdentity>;
  createPendingAction(context: AgentRequestContext, action: Omit<PendingAction, "id" | "sessionId" | "status" | "createdAt" | "completedAt" | "errorMessage"> & { sessionId: string }): Promise<PendingAction>;
  listPendingActions(context: AgentRequestContext, sessionId: string): Promise<PendingAction[]>;
  confirmPendingAction(context: AgentRequestContext, sessionId: string, actionId: string): Promise<unknown>;
  cancelPendingAction(context: AgentRequestContext, sessionId: string, actionId: string): Promise<void>;
}

export interface AgentTools {
  register(tool: ToolDefinition): () => void;
  list(): ToolDefinition[];
  execute(name: string, input: unknown, context: AgentRequestContext): Promise<unknown>;
}

export interface AgentPolicy {
  authorize(tool: ToolDefinition, input: unknown, context: AgentRequestContext): Promise<void>;
}

export interface WorkflowEngine {
  run(sessionId: string, prompt: string, context: AgentRequestContext): AsyncIterable<AgentStreamEvent>;
  resume(sessionId: string, action: PendingAction, result: unknown, context: AgentRequestContext): Promise<AgentMessage>;
}

export interface AgentMemoryService {
  retrieve(context: AgentRequestContext, query: string, limit?: number): Promise<AgentMemory[]>;
  record(context: AgentRequestContext, content: string, category?: AgentMemory["category"]): Promise<AgentMemory | undefined>;
  forget(context: AgentRequestContext): Promise<number>;
}

export interface AgentAudit {
  record(context: AgentRequestContext, event: string, payload: unknown): Promise<void>;
}

export interface AgentSandbox {
  assertAllowed(input: { command?: string; cwd?: string; network?: boolean }): Promise<void>;
  execute(input: { command: string; cwd?: string; network?: boolean; timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface AgentScheduler {
  register(name: string, task: (payload: unknown) => Promise<void>): () => void;
  schedule(name: string, delayMs: number, task: () => Promise<void>): () => void;
}

export type AgentSkill = {
  id: string;
  name: string;
  instructions: string;
  enabled: boolean;
};

export interface AgentSkills {
  list(context: AgentRequestContext): AgentSkill[];
  instructions(context: AgentRequestContext): string | undefined;
}

export interface AgentUiAdapter {
  availableAgent(): { id: string; name: string; description: string; isAiEmployee: boolean };
  publicSession(session: AgentSession): Record<string, unknown>;
}

export type AgentStreamEvent =
  | { type: "message.delta"; delta: string }
  | { type: "message.completed"; message: { id: string; runId?: string } }
  | { type: "tool.started"; name: string }
  | { type: "tool.completed"; name: string; result: unknown }
  | { type: "run.paused"; action: PendingAction }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string };

declare module "@deepseek-ai/cordis" {
  interface Context {
    storage: AgentStorage;
    sessions: AgentSessions;
    platform: PlatformClient;
    tools: AgentTools;
    policy: AgentPolicy;
    workflow: WorkflowEngine;
    memory: AgentMemoryService;
    audit: AgentAudit;
    sandbox: AgentSandbox;
    scheduler: AgentScheduler;
    skills: AgentSkills;
    ui: AgentUiAdapter;
  }

  interface Events {
    "agent/before-run"(request: { sessionId: string; prompt: string; context: AgentRequestContext }, next: () => unknown): unknown;
    "agent/event"(event: AgentStreamEvent, context: AgentRequestContext): void;
    "agent/run-state"(event: { runId: string; status: AgentRunStatus; sessionId: string }): void;
    "tool/before-execute"(tool: ToolDefinition, input: unknown, context: AgentRequestContext, next: () => unknown): unknown;
  }
}

export type AgentContext = Context;
