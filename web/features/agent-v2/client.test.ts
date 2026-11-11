import { describe, expect, it } from "vitest";
import { streamText, type AgentEvent } from "./client";

function event(seq: number, type: string, payload: Record<string, unknown>, run = "a"): AgentEvent {
  return { seq, type, payload, run_id: run, session_id: "s", event_id: String(seq), protocol_version: 1, created_at: "" };
}
describe("AgentV2 replay", () => {
  it("replaces abandoned attempt output and isolates runs", () => {
    expect(streamText([
      event(1, "message.delta", { step: 0, attempt: 1, text: "abandoned" }),
      event(2, "message.delta", { step: 0, attempt: 2, text: "new" }),
      event(3, "message.delta", { step: 0, attempt: 2, text: " answer" }),
      event(4, "message.delta", { step: 0, attempt: 2, text: "secret" }, "b"),
    ], "a")).toBe("new answer");
  });
  it("uses the persisted final answer after reconnect", () => {
    expect(streamText([event(1, "message.delta", { step: 0, attempt: 1, text: "partial" }), event(2, "run.completed", { text: "final" })], "a")).toBe("final");
  });
});
