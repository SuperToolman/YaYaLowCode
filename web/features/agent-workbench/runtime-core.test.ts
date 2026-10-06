import { describe, expect, it } from "vitest";
import { createInitialSessionState, mergeHistory, reduceSessionFrame } from "./runtime-core";
import type { AgentWorkbenchSession } from "./platform-api";

const session = (overrides: Partial<AgentWorkbenchSession> = {}): AgentWorkbenchSession => ({
  id: "s1", title: "Session", agentId: "a1", status: "active", source: "general", isPinned: false, updatedAt: new Date(0).toISOString(),
  eventGeneration: "g1", lastEventSeq: -1, runStatus: "idle", pendingApprovalCount: 0,
  unreadActivityVersion: 0, lastActivityAt: new Date(0).toISOString(), ...overrides,
});
const event = (seq: number, type = "assistant/message", data: Record<string, unknown> = {}): any => ({ type, seq, time: seq, data });

describe("agent workbench runtime reducer", () => {
  it("deduplicates and drops old events while preserving canonical order", () => {
    let state = createInitialSessionState(session());
    state = mergeHistory(state, "s1", [event(2), event(1, "user/message", { content: "hello" })]);
    expect(state.canonicalEvents.map(item => item.seq)).toEqual([1, 2]);
    const reduced = reduceSessionFrame(state, "s1", { type: "session/event", sessionId: "s1", event: event(1, "user/message", { content: "duplicate" }) }, true);
    expect(reduced.state.canonicalEvents).toHaveLength(2);
  });

  it("marks background activity unread and increments only its version", () => {
    const state = createInitialSessionState(session());
    const reduced = reduceSessionFrame(state, "s1", { type: "session/event", sessionId: "s1", event: event(0) }, false);
    expect(reduced.state.unread).toBe(true);
    expect(reduced.state.unreadVersion).toBe(1);
    expect(reduceSessionFrame(state, "s1", { type: "session/event", sessionId: "s1", event: event(0) }, true).state.unread).toBe(false);
  });

  it("requests compensation on a seq gap and resets on a new generation", () => {
    let state = createInitialSessionState(session({ lastEventSeq: 2 }));
    let result = reduceSessionFrame(state, "s1", { type: "session/subscribed", sessionId: "s1", generation: "g1", lastSeq: 8 }, true);
    expect(result.effect).toEqual({ kind: "history-gap", sessionId: "s1" });
    result = reduceSessionFrame(state, "s1", { type: "session/subscribed", sessionId: "s1", generation: "g2", lastSeq: 0 }, true);
    expect(result.effect).toEqual({ kind: "generation-reset", sessionId: "s1" });
    expect(result.state.generation).toBe("g2");
    expect(result.state.canonicalEvents).toEqual([]);
  });

  it("is idempotent for approval requests and resolutions", () => {
    let state = createInitialSessionState(session());
    const request = { type: "approval/requested", sessionId: "s1", rpcId: "r1", approvalId: "a1" } as any;
    state = reduceSessionFrame(state, "s1", request, true).state;
    state = reduceSessionFrame(state, "s1", request, true).state;
    expect(state.approvals).toHaveLength(1);
    expect(state.pendingApprovalCount).toBe(1);
    state = reduceSessionFrame(state, "s1", { type: "approval/resolved", sessionId: "s1", approvalId: "a1" }, true).state;
    expect(state.approvals).toHaveLength(0);
    expect(state.pendingApprovalCount).toBe(0);
  });

  it("does not let prepended history replace a newer failed terminal state", () => {
    let state = createInitialSessionState(session());
    state = mergeHistory(state, "s1", [event(20, "turn/end", { reason: { kind: "error", failure: { message: "模型鉴权失败" } } })]);
    expect(state.runStatus).toBe("failed");
    expect(state.phase).toBe("error");
    const next = mergeHistory(state, "s1", [event(1, "turn/start")], "prepend");
    expect(next.runStatus).toBe("failed");
    expect(next.phase).toBe("error");
  });

  it("marks a tool-result error as failed instead of leaving the session running", () => {
    let state = createInitialSessionState(session());
    state = mergeHistory(state, "s1", [event(1, "turn/start"), event(2, "tool/call", { callId: "c1", name: "write" }), event(3, "tool/result", { callId: "c1", isError: true, content: "permission denied" })]);
    expect(state.runStatus).toBe("failed");
    expect(state.phase).toBe("error");
  });
});
