export type PendingAction = {
  id: string;
  actionType: string;
  summary: string;
  status: "pending";
  createdAt: string;
  expiresAt: string;
};

export type AttachedImage = { id: string; name: string; previewUrl: string };
export type AgentToolActivity = { id: string; name: string; resourceName?: string; status: "running" | "completed" };
export type AgentOption = { id: string; name: string; description: string; isAiEmployee: boolean };

export type AgentMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt?: string;
  metadata?: unknown;
  runId?: string;
  toolActivities?: AgentToolActivity[];
  attachments?: AttachedImage[];
  pendingActions?: PendingAction[];
};

export type SessionSource = "general" | "schema_analysis" | "form_fill";
export type SessionFilter = "all" | SessionSource;
export type AgentApprovalMode = "request_approval" | "approve_on_behalf" | "full_access";
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
  | { type: "message.delta"; delta: string }
  | { type: "message.completed"; runId?: string }
  | { type: "tool.started"; name: string; resourceName?: string }
  | { type: "tool.completed"; pendingAction?: { id: string; summary: string; actionType: string; expiresInSeconds: number } }
  | { type: "run.paused"; action: PendingAction }
  | { type: "status" }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string }
  | { type: "message.failed"; message: string }
  | { type: "unknown"; eventName: string; payload: unknown };
