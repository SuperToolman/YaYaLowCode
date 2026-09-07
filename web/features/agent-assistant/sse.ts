import type { AgentSseEvent, DshSessionEvent } from "./types";

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
    case "artifact.created": return { type: "artifact.created", id: String(record.id ?? ""), name: String(record.name ?? "产物"), mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined, size: typeof record.size === "number" ? record.size : undefined, sessionId: String(record.sessionId ?? "") };
    case "dsh.session.event":
      if (typeof record.type !== "string" || typeof record.seq !== "number" || !isRecord(record.data)) return null;
      return { type: "dsh.session.event", event: record as unknown as DshSessionEvent };
    case "message.delta":
      return typeof record.delta === "string" ? { type: "message.delta", delta: record.delta } : null;
    case "reasoning.delta":
      return typeof record.delta === "string" ? { type: "reasoning.delta", delta: record.delta } : null;
    case "message.completed": {
      const message = isRecord(record.message) ? record.message : {};
      return { type: "message.completed", runId: typeof message.runId === "string" ? message.runId : undefined };
    }
    case "tool.started":
      return {
        type: "tool.started",
        name: typeof record.name === "string" ? record.name : "工具",
        resourceName: typeof record.resourceName === "string" ? record.resourceName : undefined,
        callId: typeof record.callId === "string" ? record.callId : undefined,
        arguments: record.arguments,
        command: typeof record.command === "string" ? record.command : undefined,
      };
    case "tool.completed": {
      return {
        type: "tool.completed",
        callId: typeof record.callId === "string" ? record.callId : undefined,
        result: record.result,
        error: record.error,
      };
    }
    case "status": return { type: "status" };
    case "run.completed": return { type: "run.completed" };
    case "step.started": return { type: "step.started", turn: Number(record.turn ?? 0), step: Number(record.step ?? 0) };
    case "step.completed": return { type: "step.completed", turn: Number(record.turn ?? 0), step: Number(record.step ?? 0) };
    case "run.failed": return { type: "run.failed", message: typeof record.message === "string" ? record.message : "Agent 运行失败" };
    case "message.failed": return { type: "message.failed", message: typeof record.message === "string" ? record.message : "Agent 消息生成失败" };
    default: return { type: "unknown", eventName, payload };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
