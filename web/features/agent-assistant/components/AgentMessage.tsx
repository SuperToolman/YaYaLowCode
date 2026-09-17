"use client";

import { CircleCheck, CircleExclamation, FaceRobot, GearPlay } from "@gravity-ui/icons";
import { Spinner } from "@heroui/react";
import { AgentMarkdown } from "./AgentMarkdown";
import { MySurface } from "@shared/ui/MySurface";
import type { AgentMessage as Message, AgentRunStatus, AgentTimelineItem } from "@/features/agent-assistant/types";
import { agentFileDownloadUrl } from "@/features/agent-assistant/api";
import { ThinkBlock } from "./AgentThinkBlock";
import { ToolCallCard } from "./AgentToolCallCard";

export function AgentMessage({ message, loading, runStatus }: { message: Message; loading?: boolean; runStatus?: AgentRunStatus }) {
  if (message.role === "user") return <MySurface className="w-fit max-w-[85%] self-end rounded-2xl bg-accent/12 px-4 py-3 text-foreground"><AgentMarkdown content={message.content} />{message.files?.length ? <div className="mt-2 flex flex-wrap gap-2 border-t border-current/15 pt-2 text-xs">{message.files.map((file) => <a key={file.id} className="rounded bg-background/40 px-2 py-1 underline" href={message.sessionId ? agentFileDownloadUrl(message.sessionId, file.id) : "#"} target="_blank" rel="noreferrer">{file.name}</a>)}</div> : null}</MySurface>;
  const blocks = message.timeline ?? buildBlocks(message);
  return <MySurface className="w-full min-w-0 self-start overflow-hidden rounded-2xl px-4 py-3"><div className="flex min-h-8 items-center gap-2 text-sm font-semibold text-muted"><FaceRobot className="size-5 text-accent" /><span>Agent</span></div><div className="min-w-0 pt-2">{blocks.map((block, index) => block.type === "reasoning" ? <ThinkBlock key={block.id} text={block.text} index={index} /> : block.type === "tool" ? <ToolCallCard key={block.id} activity={block.activity} /> : <AgentMarkdown key={block.id} content={block.text} />)}{message.files?.length ? <div className="mt-3 flex flex-wrap gap-2 border-t border-current/15 pt-2 text-xs">{message.files.map((file) => <a key={file.id} className="rounded bg-background/40 px-2 py-1 underline" href={message.sessionId ? agentFileDownloadUrl(message.sessionId, file.id) : "#"} target="_blank" rel="noreferrer">📎 {file.name} · {file.mimeType} · {file.size} B</a>)}</div> : null}{loading && !blocks.length ? <div className="flex items-center gap-2 py-2 text-sm text-muted"><Spinner size="sm" /><span>正在等待模型响应</span></div> : null}{runStatus ? <RunStatusChip status={runStatus} /> : null}</div></MySurface>;
}

function RunStatusChip({ status }: { status: AgentRunStatus }) {
  if (status === "completed") return <div className="mt-3 flex items-center gap-1 text-xs text-success"><CircleCheck className="size-3" />本轮已完成</div>;
  if (status === "stopped") return <div className="mt-3 text-xs text-muted">本轮已停止</div>;
  if (status === "failed") return <div className="mt-3 flex items-center gap-1 text-xs text-danger"><CircleExclamation className="size-3" />本轮运行失败</div>;
  const label = status === "thinking" ? "正在分析" : status === "working" ? "正在调用工具" : "正在回复";
  return <div className="mt-3 flex items-center gap-2 text-sm text-muted" role="status" aria-live="polite"><Spinner size="sm" /><GearPlay className="size-4 text-accent" /><span>{label}</span></div>;
}

function buildBlocks(message: Message): AgentTimelineItem[] {
  const blocks: AgentTimelineItem[] = [];
  if (message.reasoning) blocks.push({ id: `${message.id}-reasoning`, type: "reasoning", text: message.reasoning });
  for (const activity of message.toolActivities ?? []) blocks.push({ id: activity.id, type: "tool", activity });
  if (message.content) blocks.push({ id: `${message.id}-answer`, type: "answer", text: message.content });
  return blocks;
}
