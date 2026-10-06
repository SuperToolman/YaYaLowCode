export type AttachedImage = { id: string; name: string; previewUrl: string };
export type AttachedFile = { id: string; name: string; mimeType: string; size: number };
export type AgentToolActivity = { id: string; name: string; resourceName?: string; status: "running" | "completed"; arguments?: unknown; command?: string; result?: unknown; error?: unknown };
export type AgentRunStatus = "thinking" | "working" | "responding" | "completed" | "failed" | "stopped";
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
