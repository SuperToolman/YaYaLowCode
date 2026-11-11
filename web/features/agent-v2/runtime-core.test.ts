import { expect, it } from "vitest";
import { conversationMessages, toolActivities, runStatus, runTimeline } from "./runtime-core";
import { streamText } from "./client";
import type { AgentEvent, Message } from "./client";

const event = (seq: number, type: string, payload: Record<string, unknown>, run = "a"): AgentEvent => ({
  seq, type, payload, run_id: run, session_id: "s", event_id: String(seq), protocol_version: 1, created_at: "",
});

it("keeps backend active duration and run timestamps on assistant bubbles", () => {
  const messages: Message[] = [{ id: "u", session_id: "s", run_id: "a", role: "user", parts: [], created_at: "2026-11-03T08:00:00Z",
    run_progress: { active_ms: 120000, budget_ms: 1000000, model_limit: 1000, model_requests: 2, stage: 0, status: "completed" } }];
  const events = [{ ...event(1, "run.started", {}), created_at: "2026-11-03T08:01:00Z" },
    { ...event(2, "run.completed", { text: "done" }), created_at: "2026-11-03T08:05:00Z" }];
  expect(conversationMessages(messages, events).find(message => message.role === "assistant")).toMatchObject({
    elapsedMs: 120000, startedAt: "2026-11-03T08:01:00Z", finishedAt: "2026-11-03T08:05:00Z",
  });
});

it("keeps step text interleaved with its tools after streaming and terminal refresh",()=>{
 const events=[event(1,"message.delta",{step:0,attempt:1,text:"读取文件"}),event(2,"step.completed",{step:0,epoch:1,text:"读取文件"}),event(3,"tool.started",{callId:"c",name:"workspace_read_file"}),event(4,"tool.completed",{callId:"c",result:{}}),event(5,"message.delta",{step:1,attempt:1,text:"安装依赖"}),event(6,"step.completed",{step:1,epoch:1,text:"安装依赖"}),event(7,"tool.started",{callId:"d",name:"workspace_execute_code"}),event(8,"tool.completed",{callId:"d",result:{}}),event(9,"run.failed",{})];
 const tools=toolActivities(events,"a");
 const summarize=(frames:AgentEvent[])=>runTimeline(frames,"a",tools).map(b=>b.type==="tool"?b.activity.name:b.text);
 expect(summarize(events)).toEqual(["读取文件","workspace_read_file","安装依赖","workspace_execute_code"]);
 expect(summarize(events.filter(e=>e.type!=="message.delta"))).toEqual(summarize(events));
});

it("replaces only an uncommitted retry and never duplicates final text",()=>{
 const events=[event(1,"message.delta",{step:0,attempt:1,text:"partial"}),event(2,"message.delta",{step:0,attempt:2,text:"done"}),event(3,"step.completed",{step:0,epoch:2,text:"done"}),event(4,"message.delta",{step:0,attempt:1,text:"stale"})];
 expect(runTimeline(events,"a",[],"done")).toEqual([{id:"a:step:0",type:"answer",text:"done"}]);
});

it("does not turn a persisted terminal run back into responding during replay",()=>{
  const events=[event(1,"run.started",{}),event(2,"message.delta",{text:"old"})];
  expect(runStatus(events,"completed")).toBe("completed");
  expect(runStatus(events,"failed")).toBe("failed");
  expect(runStatus(events,"cancelled")).toBe("stopped");
  const messages:Message[]=[{id:"m",session_id:"s",run_id:"a",role:"assistant",parts:[{type:"text",text:"done"}],created_at:"",run_status:"completed"}];
  expect(conversationMessages(messages,events)[0].runStatus).toBe("completed");
});

it("restores execution status from persistence and does not hide timeouts as tool success",()=>{
  const events=[event(1,"tool.started",{callId:"c",name:"skill_run_script"}),event(2,"execution.running",{callId:"c",status:"running"}),event(3,"tool.completed",{callId:"c",result:{status:"timed_out"}})];
  expect(toolActivities(events,"a")[0]).toMatchObject({status:"failed",executionStatus:"timed_out"});
  const messages:Message[]=[{id:"m",session_id:"s",run_id:"a",role:"assistant",parts:[{type:"text",text:"done"}],created_at:""}];
  const restored=conversationMessages(messages,events,[],[{id:"e",runId:"a",callId:"c",status:"timed_out",result:{exitCode:137},createdAt:"",updatedAt:""}]);
  expect(restored[0].toolActivities?.[0]).toMatchObject({status:"failed",executionStatus:"timed_out",result:{exitCode:137}});
});

it("merges tool start and completion while isolating repeated call IDs across runs", () => {
  const events = [event(1, "tool.started", { callId: "c", name: "echo", arguments: { text: "hello" } }),
    event(2, "tool.completed", { callId: "c", result: "world" }),
    event(3, "tool.started", { callId: "c", name: "other" }, "b")];
  expect(toolActivities(events, "a")).toEqual([{ id: "a:c", name: "echo", arguments: { text: "hello" }, status: "completed", result: "world", error: undefined }]);
  expect(toolActivities(events, "b")[0].status).toBe("running");
});

it("places streamed replies with their own user message and replaces them with persisted history", () => {
  const messages: Message[] = ["a", "b"].map(run => ({ id: `user:${run}`, session_id: "s", run_id: run, role: "user", parts: [{ type: "text", text: run }], created_at: "" }));
  const events = [event(1, "run.completed", { text: "answer" }), event(2, "run.queued", {}, "b")];
  expect(conversationMessages(messages, events).map(message => message.id)).toEqual(["user:a", "live:a", "user:b", "live:b"]);
  messages.splice(1, 0, { id: "saved", session_id: "s", run_id: "a", role: "assistant", parts: [{ type: "text", text: "saved answer" }], created_at: "" });
  const result = conversationMessages(messages, events);
  expect(result.filter(message => message.runId === "a" && message.role === "assistant").map(message => message.content)).toEqual(["saved answer"]);
});

it("keeps persisted tool failures visible after replay", () => {
  const events = [
    event(1, "tool.started", { callId: "c", name: "platform_query_records" }),
    event(2, "tool.failed", { callId: "c", error: { code: "tool_access_denied", message: "工具未获授权" } }),
  ];
  expect(toolActivities(events, "a")[0]).toMatchObject({ status: "failed", error: { code: "tool_access_denied" } });
});

it("does not replace failed or denied outcomes with a stale confirmation state", () => {
  for (const status of ["rejected", "expired", "cancelled", "conflict"]) {
    const events = [event(1, "tool.started", { callId: "c", name: "write" }),
      event(2, "confirmation.requested", { callId: "c", confirmationId: "approval" }),
      event(3, "confirmation.resolved", { confirmationId: "approval", status }),
      event(4, "tool.completed", { callId: "c", result: { status, executed: false } })];
    expect(toolActivities(events, "a")[0].status).toBe(status);
  }
  expect(toolActivities([event(1, "tool.started", { callId: "c" }),
    event(2, "confirmation.requested", { callId: "c", confirmationId: "approval" }),
    event(3, "confirmation.resolved", { confirmationId: "approval", status: "approved" }),
    event(4, "tool.failed", { callId: "c", error: { code: "revoked" } })], "a")[0].status).toBe("failed");
});

it("shows an atomic committed effect as complete even before the worker checkpoint", () => {
  expect(toolActivities([event(1, "tool.started", { callId: "c" }),
    event(2, "confirmation.requested", { callId: "c", confirmationId: "approval" }),
    event(3, "confirmation.resolved", { confirmationId: "approval", status: "executed" })], "a")[0].status).toBe("completed");
});

it("ignores duplicate or older event frames when rebuilding streamed output", () => {
  expect(streamText([event(2,"message.delta",{step:1,attempt:1,text:"hello"}),
    event(2,"message.delta",{step:1,attempt:1,text:"hello"}),
    event(1,"message.delta",{step:1,attempt:1,text:"old"})],"a")).toBe("hello");
});

it("explains that a changed authorization policy needs a new task", async () => {
  const { runFailureMessage } = await import("./runtime-core");
  expect(runFailureMessage("task_policy_changed")).toContain("重新发送任务");
});

it("explains model response failures without implying office parsing failed",async()=>{
 const {runFailureMessage}=await import("./runtime-core");
 expect(runFailureMessage("model_output_limit")).toContain("输出上限");
 expect(runFailureMessage("empty_model_response")).toContain("未返回正文");
 expect(runFailureMessage("invalid_tool_call_id")).toContain("标识无效");
 expect(runFailureMessage("provider_rejected")).toContain("模型服务");
 expect(runFailureMessage("provider_retryable")).toContain("连接或响应异常");
});

it("keeps paused tasks quiet and restores interleaved text after stage continuation",()=>{
 const frames=[event(1,"step.completed",{step:47,epoch:1,text:"已安装依赖"}),event(2,"run.stage_completed",{automatic:true}),event(3,"run.started",{epoch:2}),event(4,"step.completed",{step:48,epoch:2,text:"继续生成交付文件"}),event(5,"run.paused",{reason:"budget_exhausted"})];
 expect(runStatus(frames,"paused")).toBe("paused");
 expect(runTimeline(frames,"a",[]).map(b=>b.type==="answer"?b.text:"")).toEqual(["已安装依赖","继续生成交付文件"]);
 expect(runStatus([...frames,event(6,"run.resumed",{})],"paused")).toBe("thinking");
 expect(runStatus([event(1,"run.manual_review",{})])).toBe("manual_review");
});
