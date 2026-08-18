import type { AgentSseEvent } from "./types";

export function parseAgentSseFrame(frame: string): AgentSseEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;

  let payload: unknown;
  try { payload = JSON.parse(dataLines.join("\n")); } catch { return null; }
  const record = isRecord(payload) ? payload : {};
  switch (eventName) {
    case "message.delta":
      return typeof record.delta === "string" ? { type: "message.delta", delta: record.delta } : null;
    case "message.completed": {
      const message = isRecord(record.message) ? record.message : {};
      return { type: "message.completed", runId: typeof message.runId === "string" ? message.runId : undefined };
    }
    case "tool.started":
      return {
        type: "tool.started",
        name: typeof record.name === "string" ? record.name : "工具",
        resourceName: typeof record.resourceName === "string" ? record.resourceName : undefined,
      };
    case "tool.completed": {
      const result = isRecord(record.result) ? record.result : {};
      const action = isRecord(result.pendingAction) ? result.pendingAction : null;
      return {
        type: "tool.completed",
        pendingAction: action && typeof action.id === "string" ? {
          id: action.id,
          summary: typeof action.summary === "string" ? action.summary : "Agent 提议执行写操作",
          actionType: typeof action.type === "string" ? action.type : "",
          expiresInSeconds: typeof action.expiresInSeconds === "number" ? action.expiresInSeconds : 86_400,
        } : undefined,
      };
    }
    case "status": return { type: "status" };
    case "run.completed": return { type: "run.completed" };
    case "run.paused": {
      const action = isRecord(record.action) ? record.action : null;
      if (!action || typeof action.id !== "string" || typeof action.actionType !== "string") return null;
      return {
        type: "run.paused",
        action: {
          id: action.id,
          actionType: action.actionType,
          summary: typeof action.summary === "string" ? action.summary : "Agent 请求审批",
          status: "pending",
          createdAt: typeof action.createdAt === "string" ? action.createdAt : new Date().toISOString(),
          expiresAt: typeof action.expiresAt === "string" ? action.expiresAt : new Date(Date.now() + 86_400_000).toISOString(),
        },
      };
    }
    case "run.failed": return { type: "run.failed", message: typeof record.message === "string" ? record.message : "Agent 运行失败" };
    case "message.failed": return { type: "message.failed", message: typeof record.message === "string" ? record.message : "Agent 消息生成失败" };
    default: return { type: "unknown", eventName, payload };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
