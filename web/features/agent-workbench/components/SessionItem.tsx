"use client";

import { Archive, ArrowRotateRight, Pencil } from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import type { AgentRunStatus, AgentSession } from "@/features/agent-assistant/types";

export function SessionItem({ session, selected, disabled, commandDisabled = false, runStatus = "completed", pendingApprovalCount = 0, unread = false, phase, lastToolName, onSelect, onRename, onArchive }: { session: AgentSession; selected?: boolean; disabled?: boolean; commandDisabled?: boolean; runStatus?: AgentRunStatus; pendingApprovalCount?: number; unread?: boolean; phase?: string; lastToolName?: string; onSelect: () => void; onRename?: () => void; onArchive?: () => void }) {
  const isRunning = runStatus === "thinking" || runStatus === "working" || runStatus === "responding";
  return <div role="button" tabIndex={disabled ? -1 : 0} aria-current={selected ? "page" : undefined} onClick={() => { if (!disabled) onSelect(); }} onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(); } }} className={`group relative flex min-h-12 w-full cursor-pointer items-center rounded-lg px-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus ${selected ? "bg-accent/12 text-accent" : "text-foreground hover:bg-default/70"}`}>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || "新对话"}</span><SessionStatus status={runStatus} />{unread ? <span className="size-1.5 rounded-full bg-accent" aria-label="有未读活动" /> : null}{pendingApprovalCount ? <span className="text-xs text-warning" title="待审批">{pendingApprovalCount}</span> : null}</span>{phase || lastToolName ? <span className={`block truncate text-xs ${phase === "error" ? "text-danger" : "text-muted"}`}>{phase === "error" ? "执行失败" : phase || lastToolName}</span> : null}</span>
    <div className="absolute right-1 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {onRename ? <Button isIconOnly size="sm" variant="ghost" aria-label="重命名会话" isDisabled={commandDisabled} onPress={(event) => { event.continuePropagation(); onRename(); }}><Pencil /></Button> : null}
      {onArchive && !isRunning ? <Button isIconOnly size="sm" variant="ghost" aria-label="归档会话" isDisabled={commandDisabled} onPress={(event) => { event.continuePropagation(); onArchive(); }}><Archive /></Button> : null}
    </div>
  </div>;
}

function SessionStatus({ status }: { status: AgentRunStatus }) {
  if (status !== "thinking" && status !== "working" && status !== "responding") return null;
  return <ArrowRotateRight className="size-3 shrink-0 animate-spin text-accent" aria-label="会话正在运行" />;
}
