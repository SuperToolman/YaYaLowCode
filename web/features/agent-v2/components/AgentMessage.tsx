"use client";

import { CircleCheck, CircleExclamation, Clock, Pause } from "@gravity-ui/icons";
import Image from "next/image";
import { Avatar, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { evidenceSources } from "@/features/knowledge/evidence-sources";
import type { AgentMessage as Message, AgentRunStatus } from "../types";
import { ForkSessionButton } from "./ForkSessionButton";
import { MessageTokenUsage } from "./MessageTokenUsage";
import { AgentMarkdown } from "./AgentMarkdown";
import { ThinkBlock } from "./AgentThinkBlock";
import { groupToolCalls, ToolCallGroup } from "./AgentToolCallGroup";

export type AgentMessageProps = {
  message: Message;
  loading?: boolean;
  runStatus?: AgentRunStatus;
  employeeName?: string;
  employeeAvatarUrl?: string;
  forkDisabled?: boolean;
  onFork?: (clientRequestId:string)=>Promise<boolean>;
};

export function AgentMessage({
  message,
  loading,
  runStatus,
  employeeName = "AI 员工",
  employeeAvatarUrl,
  forkDisabled = false,
  onFork,
}: AgentMessageProps) {
  const isUser = message.role === "user";
  const status = runStatus ?? message.runStatus ?? (loading ? "thinking" : undefined);
  const blocks = message.timeline ?? [
    ...(message.reasoning
      ? [
          {
            id: `${message.id}:reasoning`,
            type: "reasoning" as const,
            text: message.reasoning,
          },
        ]
      : []),
    ...(message.toolActivities ?? []).map((activity) => ({
      id: activity.id,
      type: "tool" as const,
      activity,
    })),
    ...(message.content
      ? [
          {
            id: `${message.id}:answer`,
            type: "answer" as const,
            text: message.content,
          },
        ]
      : []),
  ];
  const citationIds = blocks.flatMap((block) => {
    if (block.type !== "tool" || !block.activity.name.startsWith("knowledge_")) return [];
    const raw = block.activity.result;
    if (!raw || typeof raw !== "object") return [];
    const root = raw as Record<string, unknown>;
    const data = root.result && typeof root.result === "object" ? root.result as Record<string, unknown> : root;
    return evidenceSources(data.items).map((item) => String(item.citationId));
  });
  return (
    <div className={`flex min-w-0 items-start gap-2.5 ${isUser ? "max-w-[85%] self-end" : "w-full self-start"}`}>
      {!isUser ? (
        <Avatar size="sm" role="img" aria-label={`${employeeName}的头像`} className="mt-1 size-8 shrink-0 bg-app-primary/10 text-app-primary">
          <Avatar.Image src={employeeAvatarUrl} alt={`${employeeName}的头像`} />
          <Avatar.Fallback>{employeeName.trim().slice(0, 1) || "AI"}</Avatar.Fallback>
        </Avatar>
      ) : null}
      <div className={`flex min-w-0 flex-col gap-3 rounded-2xl bg-[var(--color-bg-subtle)] px-4 py-3 shadow-sm ${isUser ? "rounded-tr-sm" : "flex-1 rounded-tl-sm"}`}>
        <div className="text-xs font-medium text-muted">{isUser ? "你" : employeeName}</div>
        <div className="flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere]">
          {isUser ? (
            <AgentMarkdown content={message.content} />
          ) : (
            groupToolCalls(blocks).map((block, index) =>
              block.type === "calls" ? (
                <ToolCallGroup key={block.id} activities={block.activities} sessionId={message.sessionId} />
              ) : block.type === "reasoning" ? (
                <ThinkBlock key={block.id} text={block.text} index={index} running={status === "thinking" && !block.complete} />
              ) : (
                <AgentMarkdown key={block.id} content={block.text} citationIds={citationIds} />
              ),
            )
          )}
          {message.attachments?.length ? (
            <div className="flex flex-wrap gap-2">
              {message.attachments.map(file => (
                <a key={file.id} href={file.previewUrl} target="_blank" rel="noreferrer" aria-label={`查看图片 ${file.name}`} className="min-w-0 overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-app-primary">
                  <Image src={file.previewUrl} alt={file.name} width={240} height={180} unoptimized className="max-h-48 w-auto max-w-full object-contain" />
                </a>
              ))}
            </div>
          ) : null}
          {message.files?.map(file => (
            <a key={file.id} href={file.downloadUrl} target="_blank" rel="noreferrer" className="w-fit max-w-full rounded-lg bg-[var(--color-bg-surface)] px-3 py-2 text-sm underline-offset-4 hover:underline">
              {file.name}
            </a>
          ))}
          {!isUser && loading && !blocks.length ? (
            <div className="flex items-center gap-1.5 py-1" aria-label="正在处理">
              <span className="size-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:150ms] motion-reduce:animate-none" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:300ms] motion-reduce:animate-none" />
            </div>
          ) : null}
        </div>
        {!isUser && status ? (
          <div className="flex flex-wrap items-center gap-2">
            {message.historySnapshot ? <span className="text-xs text-muted">历史快照</span> : <MessageStatus
              key={`${message.id}:${status}:${message.elapsedMs ?? ""}:${message.startedAt ?? ""}`}
              status={status}
              elapsedMs={message.elapsedMs}
              startedAt={message.startedAt}
              finishedAt={message.finishedAt}
            />}
            <MessageTokenUsage usage={message.tokenUsage ?? null} />
            {status==="completed" && onFork && <ForkSessionButton disabled={forkDisabled} onFork={onFork} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDuration(duration: number): string {
  if (!Number.isFinite(duration)) return "—";
  const totalSeconds = Math.floor(Math.max(0, duration) / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours) return `${hours}小时${minutes ? `${minutes}分` : ""}${seconds ? `${seconds}秒` : ""}`;
  if (minutes) return seconds ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
  return `${seconds}秒`;
}

function MessageStatus({ status, elapsedMs, startedAt, finishedAt }: {
  status: AgentRunStatus;
  elapsedMs?: number;
  startedAt?: string;
  finishedAt?: string;
}) {
  const running = ["thinking", "working", "responding"].includes(status);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const start = Date.parse(startedAt ?? "");
  const end = running ? now : Date.parse(finishedAt ?? "");
  const duration = elapsedMs !== undefined && Number.isFinite(elapsedMs)
    ? elapsedMs + (running ? now - mountedAt : 0)
    : end - start;
  const elapsed = formatDuration(duration);
  const text = status === "completed" ? `用时${elapsed}（完成）`
    : status === "stopped" || status === "paused" ? `你在${elapsed}后停止（暂停）`
    : status === "failed" ? `用时${elapsed}（失败）`
    : status === "manual_review" ? `已经处理${elapsed}（待核对）`
    : status === "waiting_confirmation" ? `已经处理${elapsed}（等待确认）`
    : `已经处理${elapsed}（运行中）`;
  return (
    <div role="status" className={`flex items-center gap-1.5 text-xs tabular-nums ${status === "failed" ? "text-danger" : "text-muted"}`}>
      {running ? <Spinner size="sm" className="size-3.5" />
        : status === "completed" ? <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />
        : status === "failed" ? <CircleExclamation className="size-3.5 shrink-0" aria-hidden="true" />
        : status === "stopped" || status === "paused" ? <Pause className="size-3.5 shrink-0" aria-hidden="true" />
        : <Clock className="size-3.5 shrink-0" aria-hidden="true" />}
      <span>{text}</span>
    </div>
  );
}
