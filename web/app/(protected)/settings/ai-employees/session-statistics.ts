import { listSessions, type Session } from "@/features/agent-v2/client";
import type { AgentV2TokenUsage } from "@/shared/lib/http";

export async function loadEmployeeSessions(): Promise<Session[]> {
  const sessions = new Map<string, Session>();
  let cursor: string | undefined;
  do {
    const page = await listSessions(undefined, { cursor, include_token_usage: true });
    if (!page) throw new Error("加载员工会话统计失败");
    for (const session of page.items) sessions.set(session.id, session);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return [...sessions.values()];
}

export function sumTokenUsage(sessions: Session[]): AgentV2TokenUsage | null {
  const usages = sessions.flatMap((session) => session.token_usage ? [session.token_usage] : []);
  if (!usages.length) return null;
  return usages.reduce((total, usage) => ({
    input_tokens: total.input_tokens + usage.input_tokens,
    output_tokens: total.output_tokens + usage.output_tokens,
    total_tokens: total.total_tokens + usage.total_tokens,
    reported_requests: total.reported_requests + usage.reported_requests,
    model_requests: total.model_requests + usage.model_requests,
    unreported_requests: total.unreported_requests + usage.unreported_requests,
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0, reported_requests: 0, model_requests: 0, unreported_requests: 0 });
}

export function tokenCount(usage: AgentV2TokenUsage | null | undefined, field: "input_tokens" | "output_tokens" | "total_tokens") {
  return usage && usage.reported_requests > 0 ? usage[field].toLocaleString("zh-CN") : "—";
}

export function tokenStatus(usage: AgentV2TokenUsage | null | undefined) {
  if (!usage || usage.reported_requests === 0) return "暂无供应商用量记录";
  return usage.unreported_requests > 0 ? "记录不完整" : "已记录";
}
