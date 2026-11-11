import { streamText, type AgentEvent, type Message, type WorkspaceFile, type ExecutionRecord } from "./client";
import type { AgentMessage, AgentRunStatus, AgentToolActivity, AgentTimelineItem } from "./types";

/** Provider-returned display reasoning is separate from answers; retries replace their own step. */
export function runTimeline(events: AgentEvent[], runId: string, tools: AgentToolActivity[], finalText = ""): AgentTimelineItem[] {
  const ordered = [...new Map(events.filter(e=>e.run_id===runId).map(e=>[e.seq,e])).values()].sort((a,b)=>a.seq-b.seq);
  const steps = new Map<string,{seq:number;attempt:number;text:string;committed:boolean}>();
  const thoughts=new Map<string,{seq:number;attempt:number;text:string;complete:boolean}>();
  const positions = new Map<string,number>();
  for (const e of ordered) {
    if(e.type === "tool.started" && typeof e.payload.callId === "string") {
      const id=`${runId}:${e.payload.callId}`;if(!positions.has(id))positions.set(id,e.seq);
    }
    if(e.type==="message.reasoning.summary") {
      const key=String(e.payload.step ?? 0),attempt=Number(e.payload.attempt ?? 0),previous=thoughts.get(key);
      if(!previous || attempt>=previous.attempt) {
        const text=typeof e.payload.text==="string"?e.payload.text:"";
        thoughts.set(key,{seq:previous?.attempt===attempt?previous.seq:e.seq,attempt,text:previous?.attempt===attempt?previous.text+text:text,complete:true});
      }
      continue;
    }
    if(!["message.delta","step.completed"].includes(e.type))continue;
    const key=String(e.payload.step ?? 0), attempt=Number(e.payload.attempt ?? e.payload.epoch ?? 0);
    const previous=steps.get(key);
    if(previous && (previous.committed || attempt<previous.attempt))continue;
    const text=typeof e.payload.text === "string" ? e.payload.text : "";
    if(e.type==="step.completed" && !text && previous) {previous.committed=true;continue;}
    steps.set(key,{seq:previous?.attempt===attempt?previous.seq:e.seq,attempt,
      text:e.type==="message.delta" && previous?.attempt===attempt ? previous.text+text:text,
      committed:e.type==="step.completed"});
  }
  const blocks: {seq:number;block:AgentTimelineItem}[]=[];
  for(const [step,value] of thoughts) if(value.text) blocks.push({seq:value.seq,block:{id:`${runId}:thought:${step}`,type:"reasoning",text:value.text,complete:value.complete}});
  for(const [step,value] of steps) if(value.text) blocks.push({seq:value.seq,block:{id:`${runId}:step:${step}`,type:"answer",text:value.text}});
  for(const tool of tools) blocks.push({seq:positions.get(tool.id) ?? Number.MAX_SAFE_INTEGER-1,block:{id:tool.id,type:"tool",activity:tool}});
  blocks.sort((a,b)=>a.seq-b.seq);
  const last=blocks.at(-1)?.block;
  if(finalText && !(last?.type==="answer" && last.text===finalText))blocks.push({seq:Number.MAX_SAFE_INTEGER,block:{id:`${runId}:final`,type:"answer",text:finalText}});
  return blocks.map(item=>item.block);
}

export function runStatus(events: AgentEvent[], fallback?: string | null): AgentRunStatus {
  // A persisted terminal status cannot be undone by replaying older deltas/start events.
  if (fallback === "completed") return "completed";
  if (fallback === "failed") return "failed";
  if (fallback === "cancelled") return "stopped";
  const last = [...events].reverse().find(event => event.type.startsWith("run."));
  const status = last?.type.replace("run.", "") ?? fallback;
  if ((fallback === "paused" || fallback === "manual_review") && !["resumed","queued","started","completed","cancelled","failed"].includes(status??"")) return fallback;
  if (status === "paused") return "paused";
  if (status === "manual_review") return "manual_review";
  if (status === "waiting_confirmation") return "waiting_confirmation";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "stopped";
  const tool = [...events].reverse().find(event => event.type.startsWith("tool.") || event.type === "message.delta");
  return tool?.type === "tool.started" ? "working" : tool?.type === "message.delta" ? "responding" : "thinking";
}

/** Replay is scoped by run + call, so reused provider call IDs cannot mix tool results. */
export function toolActivities(events: AgentEvent[], runId: string): AgentToolActivity[] {
  const tools = new Map<string, AgentToolActivity>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.run_id !== runId || (!event.type.startsWith("tool.") && !event.type.startsWith("execution."))) continue;
    const callId = event.payload.callId;
    if (typeof callId !== "string") continue;
    const previous = tools.get(callId);
    if (event.type.startsWith("execution.")) {
      if (previous) tools.set(callId, { ...previous, executionId: typeof event.payload.executionId === "string" ? event.payload.executionId : previous.executionId, executionStatus: String(event.payload.status), result: event.payload.result ?? previous.result,
        status: ["failed","timed_out","outcome_unknown"].includes(String(event.payload.status)) ? "failed" : event.payload.status === "cancelled" ? "cancelled" : event.payload.status === "succeeded" ? "completed" : "running" });
      continue;
    }
    tools.set(callId, {
      ...previous,
      id: `${runId}:${callId}`,
      name: typeof event.payload.name === "string" ? event.payload.name : previous?.name ?? callId,
      arguments: event.payload.arguments ?? previous?.arguments,
      executionStatus: event.payload.result && typeof event.payload.result === "object" && "status" in event.payload.result ? String(event.payload.result.status) : previous?.executionStatus,
      status: event.type === "tool.started" ? "running" : event.type === "tool.failed" ? "failed" : toolResultStatus(event.payload.result),
      result: event.payload.result ?? previous?.result,
      error: event.payload.error ?? previous?.error,
    });
  }
  for (const event of events) {
    if (event.run_id !== runId || event.type !== "confirmation.requested") continue;
    const call = typeof event.payload.callId === "string" ? tools.get(event.payload.callId) : undefined;
    if (!call || call.status !== "running") continue;
    const resolved = [...events].sort((a, b) => b.seq - a.seq).find(item => item.run_id === runId && item.type === "confirmation.resolved" && item.payload.confirmationId === event.payload.confirmationId);
    const state = resolved?.payload.status;
    call.status = state === "executed" ? "completed" : state === "approved" ? "running" : ["rejected", "expired", "cancelled", "conflict"].includes(String(state)) ? state as "rejected" | "expired" | "cancelled" | "conflict" : "waiting_confirmation";
  }
  return [...tools.values()];
}

function toolResultStatus(result: unknown): AgentToolActivity["status"] {
  if (result && typeof result === "object" && "status" in result && ["failed", "timed_out", "outcome_unknown"].includes(String(result.status))) return "failed";
  if (result && typeof result === "object" && "executed" in result && result.executed === false && "status" in result) {
    if (["rejected", "expired", "cancelled", "conflict"].includes(String(result.status))) return result.status as AgentToolActivity["status"];
  }
  return "completed";
}

export function conversationMessages(messages: Message[], events: AgentEvent[], files: WorkspaceFile[] = [], executions: ExecutionRecord[] = []): AgentMessage[] {
  const result: AgentMessage[] = messages.filter(message => message.role === "user" || message.role === "assistant").map(message => ({
    id: message.id, historySnapshot: message.history_snapshot, sessionId: message.session_id, runId: message.run_id,
    role: message.role as "user" | "assistant", createdAt: message.created_at,
    runStatus: message.role === "assistant" ? runStatus(events.filter(event=>event.run_id===message.run_id),message.run_status ?? "completed") : undefined,
    content: message.parts.filter(part=>part.type==="text").map(part=>part.text).join("\n"),
    attachments: message.parts.filter(part=>part.type==="image").map(part=>{const file=files.find(f=>f.id===part.fileId);return {id:part.fileId,name:file?.name??"图片附件",previewUrl:file?.downloadUrl??`/api/agent/v2/sessions/${message.session_id}/files/${part.fileId}`};}),
    files: message.parts.filter(part=>part.type==="file").map(part=>{const file=files.find(f=>f.id===part.fileId);return {id:part.fileId,name:file?.name??"附件",mimeType:file?.mimeType??"application/octet-stream",size:file?.size??0,downloadUrl:file?.downloadUrl??`/api/agent/v2/sessions/${message.session_id}/files/${part.fileId}`};}),
    ...(message.role === "assistant" ? { toolActivities: toolActivities(events, message.run_id) } : {}),
  }));
  const runs = [...new Set(events.map(event => event.run_id).filter((id): id is string => Boolean(id)))];
  for (const runId of runs) {
    if (result.some(message => message.runId === runId && message.role === "assistant")) continue;
    const runEvents = events.filter(event => event.run_id === runId);
    const content = streamText(events, runId);
    const tools = toolActivities(events, runId);
    if (!content && !tools.length && !runEvents.some(event => event.type.startsWith("run."))) continue;
    const saved=messages.find(message=>message.run_id===runId);
    const message: AgentMessage = { historySnapshot:saved?.history_snapshot, id: `live:${runId}`, role: "assistant", sessionId:saved?.session_id ?? messages[0]?.session_id, runId, content, toolActivities: tools, runStatus:runStatus(runEvents,saved?.run_status) };
    const userIndex = result.findLastIndex(item => item.runId === runId);
    if (userIndex < 0) result.push(message);
    else result.splice(userIndex + 1, 0, message);
  }
  for (const message of result) {
    if (message.role === "assistant") {
      const runEvents = events.filter(event => event.run_id === message.runId).sort((a, b) => a.seq - b.seq);
      const source = messages.find(item => item.run_id === message.runId && item.role === "user");
      const saved = messages.find(item => item.id === message.id);
      const progress = source?.run_progress ?? saved?.run_progress;
      message.startedAt = runEvents.find(event => event.type === "run.started")?.created_at || source?.created_at;
      const terminal = runEvents.findLast(event => ["run.completed", "run.failed", "run.cancelled", "run.paused", "run.manual_review"].includes(event.type));
      const inactive = ["completed", "failed", "stopped", "paused", "manual_review"].includes(message.runStatus ?? "");
      message.finishedAt = inactive ? terminal?.created_at || saved?.created_at : undefined;
      message.elapsedMs = progress?.active_ms;
      message.tokenUsage = source?.token_usage ?? saved?.token_usage;
    }
    for (const activity of message.toolActivities ?? []) {
      const execution=executions.find(e=>e.runId===message.runId && `${e.runId}:${e.callId}`===activity.id);
      if (!execution) continue;
      activity.executionId=execution.id;
      activity.executionStatus=execution.status;
      activity.status=["failed","timed_out","outcome_unknown"].includes(execution.status)?"failed":execution.status==="cancelled"?"cancelled":execution.status==="succeeded"?"completed":"running";
      if (execution.result) activity.result=execution.result;
    }
    if(message.role==="assistant") message.timeline=runTimeline(events,message.runId ?? "",message.toolActivities ?? [],
      messages.some(m=>m.id===message.id) ? message.content :
      String(events.findLast(e=>e.run_id===message.runId && e.type==="run.completed")?.payload.text ?? ""));
  }
  return result;
}

export function runFailureMessage(code: unknown): string {
  if (code === "provider_unavailable") return "模型服务繁忙或暂时不可用（HTTP 503），自动重试后仍未成功。请稍后重试或切换模型；文件和已有工具结果仍保留。";
  if (code === "provider_rate_limited") return "模型服务限制了请求频率或额度（HTTP 429），自动重试后仍未成功。请检查模型服务额度或稍后重试；文件和已有工具结果仍保留。";
  if (code === "execution_failed") return "任务执行失败，当前记录没有保存具体原因，需要查看服务端日志定位；文件和已有工具结果仍保留。";
  if (code === "step_budget_exceeded") return "这条历史任务被旧版步数限制中止。当前版本已取消该限制；历史失败任务不会自动重跑，已安装依赖和会话文件仍保留。";
  if (code === "provider_rejected") return "模型服务未能完成本次调用，任务已停止。请稍后重试；附件仍保存在当前会话工作区。此错误不代表 Skill 缺少依赖。";
  if (code === "provider_retryable") return "模型服务连接或响应异常，重试后仍未成功。请稍后重试，已保存的文件和工具结果仍保留。";
  if (code === "model_output_limit") return "模型生成达到单次输出上限，未将不完整结果视为完成。可调整该模型的单次最大输出 token 配置后重试。";
  if (code === "empty_model_response") return "模型未返回正文或工具调用，自动重试后仍未成功。请稍后重试，已上传文件和工具结果仍保留。";
  if (code === "invalid_tool_call_id") return "模型返回的工具调用标识无效，任务已停止；请重新发送任务。";
  if (code === "tool_contract_changed") return "工具版本已更新，请重新发送任务；旧确认不会自动执行。";
  if (code === "attachment_context_budget_exceeded") return "单次模型请求的附件总量超过 24 MiB 传输限制；文件仍保存在工作区。";
  if (code === "attachment_text_budget_exceeded") return "文本附件超过模型读取限制（256 KiB），文件已保存在工作区，请缩小文件后重试。";
  if (code === "task_policy_changed") return "任务权限规则已更新，请重新发送任务；旧确认不会自动执行。";
  return `执行失败：${String(code ?? "未知错误")}`;
}
