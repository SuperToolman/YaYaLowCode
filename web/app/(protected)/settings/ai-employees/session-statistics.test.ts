import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSessions, type Session } from "@/features/agent-v2/client";
import { loadEmployeeSessions, sumTokenUsage, tokenCount, tokenStatus } from "./session-statistics";

vi.mock("@/features/agent-v2/client", () => ({ listSessions: vi.fn() }));
const usage = { input_tokens: 1000, output_tokens: 25, total_tokens: 1025, reported_requests: 1, model_requests: 1, unreported_requests: 0 };
const session = (id: string, token_usage: Session["token_usage"] = usage) => ({ id, token_usage }) as Session;
beforeEach(() => vi.resetAllMocks());

describe("employee session statistics", () => {
  it("loads every cursor page and avoids duplicate sessions in totals", async () => {
    vi.mocked(listSessions).mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, i) => session(String(i))), next_cursor: "page-2" })
      .mockResolvedValueOnce({ items: [session("49"), session("50")], next_cursor: null });
    const sessions = await loadEmployeeSessions();
    expect(listSessions).toHaveBeenLastCalledWith(undefined, { cursor: "page-2", include_token_usage: true });
    expect(sessions).toHaveLength(51);
    expect(sumTokenUsage(sessions)?.total_tokens).toBe(51 * 1025);
  });
  it("preserves missing request counts when aggregating sessions", () => {
    const total = sumTokenUsage([session("a"), session("b", { ...usage, input_tokens: 0, output_tokens: 0, total_tokens: 0, reported_requests: 0, model_requests: 2, unreported_requests: 2 })]);
    expect(total).toEqual({ ...usage, model_requests: 3, unreported_requests: 2 });
    expect(tokenStatus(total)).toBe("记录不完整");
    expect(tokenCount(total, "input_tokens")).toBe("1,000");
  });
  it("does not present absent supplier usage as zero consumption", () => {
    expect(sumTokenUsage([])).toBeNull();
    const empty = sumTokenUsage([session("a", { ...usage, input_tokens: 0, output_tokens: 0, total_tokens: 0, reported_requests: 0 })]);
    expect(tokenCount(empty, "total_tokens")).toBe("—");
    expect(tokenStatus(empty)).toBe("暂无供应商用量记录");
    expect(tokenStatus(usage)).toBe("已记录");
  });
  it("rejects a failed later page instead of returning a partial total", async () => {
    vi.mocked(listSessions).mockResolvedValueOnce({ items: [session("a")], next_cursor: "page-2" }).mockRejectedValueOnce(new Error("failed"));
    await expect(loadEmployeeSessions()).rejects.toThrow("failed");
  });
});
