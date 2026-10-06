import { describe, expect, it } from "vitest";
import fixture from "../fixtures/v1.json";
import { createConversationProjection, unwrapMuxFrame, validateRpcEnvelope } from "./index";

describe("YaYa Workbench mux contract", () => {
  it("accepts every locked fixture frame", () => {
    for (const frame of fixture.mux) expect(unwrapMuxFrame(frame)).toEqual(frame);
  });

  it("rejects unknown frames and sessionless session data", () => {
    expect(unwrapMuxFrame({ type: "host.describe" })).toBeNull();
    expect(unwrapMuxFrame({ type: "session/event", event: { type: "turn/start", seq: 1 } })).toBeNull();
    expect(unwrapMuxFrame({ type: "session/event", sessionId: "s", event: { type: "turn/start", seq: "1" } })).toBeNull();
  });

  it("retains server-request correlation for native responses", () => {
    expect(unwrapMuxFrame({
      type: "server-request",
      rpcId: "approval-request-1",
      method: "approval/requested",
      payload: { type: "approval/requested", sessionId: "s", approvalId: "a", toolName: "bash" },
    })).toMatchObject({ type: "approval/requested", rpcId: "approval-request-1", sessionId: "s" });
  });

  it("rejects unsupported RPC methods and mismatched responses", () => {
    expect(validateRpcEnvelope({ type: "server-response", rpcId: "x", result: { ok: true, value: {} } }, "x", "session.selectModel")).toBe(true);
    expect(validateRpcEnvelope({ type: "server-response", rpcId: "x", result: { ok: true, value: {} } }, "x", "host.describe")).toBe(false);
    expect(validateRpcEnvelope({ type: "server-response", rpcId: "x", result: { ok: true, value: {} } }, "y", "session.history")).toBe(false);
    expect(validateRpcEnvelope({ type: "server-response", rpcId: "x", result: { ok: false, error: { message: "no" } } }, "x", "session.history")).toBe(true);
  });

  it("rejects malformed canonical events and accepts all declared frame types", () => {
    expect(unwrapMuxFrame({ type: "session/event", sessionId: "s", event: { type: "turn/start", seq: 1 } })).toBeNull();
    for (const type of ["session/projection", "session/jobs", "question/requested", "question/resolved", "artifact/registered", "stream/error"]) {
      const frame = type === "stream/error" ? { type } : { type, sessionId: "s" };
      expect(unwrapMuxFrame(frame)).not.toBeNull();
    }
  });

  it("converges history and live events into stable native projection nodes", () => {
    const events: any[] = [
      { type: "user/message", seq: 1, time: 1, data: { content: "hello" } },
      { type: "assistant/chunk", seq: 2, time: 2, data: { chunk: { type: "text-delta", text: "hi" } } },
      { type: "tool/call", seq: 3, time: 3, data: { callId: "c1", name: "search" } },
      { type: "tool/result", seq: 4, time: 4, data: { callId: "c1", message: "done" } },
      { type: "future/event", seq: 5, time: 5, data: { value: 1 } },
    ];
    const history = createConversationProjection();
    const live = createConversationProjection();
    const fromHistory = history.replaceWindow(events, true);
    live.replaceWindow(events.slice(0, 2));
    for (const event of events.slice(2)) live.appendEvent(event);
    expect(live.snapshot().nodes).toEqual(fromHistory.nodes);
    expect(fromHistory.nodes.find(node => node.kind === "tool")).toMatchObject({ status: "completed", name: "search" });
    expect(fromHistory.nodes.at(-1)).toMatchObject({ kind: "fallback", eventType: "future/event" });
    expect(history.prependHistory([events[0]], true).nodes.map(node => node.id)).toEqual(fromHistory.nodes.map(node => node.id));
  });

  it("settles an unfinished tool when DSH emits an error result or terminal turn", () => {
    const projection = createConversationProjection();
    const failed = projection.replaceWindow([
      { type: "tool/call", seq: 1, time: 1, data: { callId: "c1", name: "write" } },
      { type: "tool/result", seq: 2, time: 2, data: { callId: "c1", isError: true, content: "permission denied" } },
    ] as any);
    expect(failed.nodes.find(node => node.kind === "tool")).toMatchObject({ status: "failed" });

    const terminal = createConversationProjection().replaceWindow([
      { type: "tool/call", seq: 1, time: 1, data: { callId: "c2", name: "search" } },
      { type: "turn/end", seq: 2, time: 2, data: { reason: { kind: "error" } } },
    ] as any);
    expect(terminal.nodes.find(node => node.kind === "tool")).toMatchObject({ status: "failed" });
  });

  it("keeps runtime injections and session control events out of the chat transcript", () => {
    const projection = createConversationProjection();
    const snapshot = projection.replaceWindow([
      { type: "user/message", seq: 1, time: 1, data: { content: "<yaya_context>secret</yaya_context>", source: { kind: "plugin", plugin: "yaya" } } },
      { type: "user/message", seq: 2, time: 2, data: { content: "你好", source: { kind: "user" } } },
      { type: "session/title", seq: 3, time: 3, data: { title: "你好" } },
      { type: "request/header", seq: 4, time: 4, data: { provider: "internal" } },
      { type: "agent/inbox/spliced", seq: 5, time: 5, data: { target: "next-turn" } },
      { type: "permission/preset", seq: 6, time: 6, data: { preset: "danger-full-access" } },
      { type: "sandbox/mode", seq: 7, time: 7, data: { mode: "danger-full-access" } },
      { type: "approval/policy", seq: 8, time: 8, data: { policy: "never" } },
      { type: "assistant/message", seq: 9, time: 9, data: { content: "你好，有什么可以帮你？" } },
    ] as any);
    expect(snapshot.nodes).toEqual([
      expect.objectContaining({ kind: "user", text: "你好" }),
      expect.objectContaining({ kind: "assistant", text: "你好，有什么可以帮你？" }),
    ]);
  });
});
