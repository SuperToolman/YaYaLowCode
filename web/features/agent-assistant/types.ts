export type AttachedImage = { id: string; name: string; previewUrl: string };
export type AttachedFile = { id: string; name: string; mimeType: string; size: number };
export type AgentToolActivity = { id: string; name: string; resourceName?: string; status: "running" | "completed"; arguments?: unknown; command?: string; result?: unknown; error?: unknown };
export type AgentRunStatus = "thinking" | "working" | "responding" | "completed" | "failed" | "stopped";
export type AgentRuntimeStatus = "running" | "completed" | "failed" | "stopped" | "idle";
export type AgentTimelineItem =
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "tool"; activity: AgentToolActivity }
  | { id: string; type: "answer"; text: string };
export type AgentTimelineInput =
  | { type: "reasoning"; text: string }
  | { type: "tool"; activity: AgentToolActivity }
  | { type: "answer"; text: string };
export type AgentOption = { id: string; name: string; description: string; isAiEmployee: boolean; avatarUrl?: string | null };

export type AgentMessage = {
  id: string;
  sessionId?: string;
  role: "assistant" | "user";
  content: string;
  createdAt?: string;
  metadata?: unknown;
  runId?: string;
  toolActivities?: AgentToolActivity[];
  reasoning?: string;
  attachments?: AttachedImage[];
  files?: AttachedFile[];
  timeline?: AgentTimelineItem[];
};

export type SessionSource = "general" | "form_fill";
export type SessionFilter = "all" | SessionSource;
export type AgentSession = {
  id: string;
  agentId: string;
  title: string;
  appId?: string;
  status: string;
  source: SessionSource;
  isPinned: boolean;
  modelProvider?: string | null;
  updatedAt: string;
};

export type AgentPageContext = {
  appId?: string;
  formUuid?: string;
  automationId?: string;
  route: string;
};

export type AgentRunTrace = {
  runId: string;
  status: string;
  steps: Array<{ index: number; tool: string; arguments: unknown; summary: unknown; status: string }>;
};

export type AgentSseEvent =
  | { type: "artifact.created"; id: string; name: string; mimeType?: string; size?: number; sessionId: string }
  | { type: "dsh.session.event"; event: DshSessionEvent }
  | { type: "message.delta"; delta: string }
  | { type: "reasoning.delta"; delta: string }
  | { type: "message.completed"; runId?: string }
  | { type: "tool.started"; name: string; resourceName?: string; callId?: string; arguments?: unknown; command?: string }
  | { type: "tool.completed"; callId?: string; result?: unknown; error?: unknown }
  | { type: "step.started"; turn: number; step: number }
  | { type: "step.completed"; turn: number; step: number }
  | { type: "status" }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string }
  | { type: "message.failed"; message: string }
  | { type: "unknown"; eventName: string; payload: unknown };

export type DshSessionEvent = {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
  surfaceOp?: unknown;
  sourceEventSeqs?: number[];
};
