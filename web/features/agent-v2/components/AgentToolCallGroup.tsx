"use client";

import { ArrowChevronDown, Code } from "@gravity-ui/icons";
import { useId, useState } from "react";
import type { AgentTimelineItem, AgentToolActivity } from "../types";
import { ToolCallCard } from "./AgentToolCallCard";

export const isScriptCall = (activity: AgentToolActivity) =>
  ["workspace_execute_code", "skill_run_script"].includes(activity.name) || Boolean(activity.executionId || activity.executionStatus);

type DisplayBlock = Exclude<AgentTimelineItem, { type: "tool" }> | {
  id: string;
  type: "calls";
  activities: AgentToolActivity[];
};

/** Only adjacent calls of the same category share a group; text and reasoning are boundaries. */
export function groupToolCalls(blocks: AgentTimelineItem[]): DisplayBlock[] {
  const result: DisplayBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "tool") {
      result.push(block);
      continue;
    }
    const previous = result.at(-1);
    if (previous?.type === "calls" && isScriptCall(previous.activities[0]) === isScriptCall(block.activity)) {
      previous.activities.push(block.activity);
    } else {
      result.push({ id: block.id, type: "calls", activities: [block.activity] });
    }
  }
  return result;
}

export function ToolCallGroup({ activities, sessionId }: { activities: AgentToolActivity[]; sessionId?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (activities.length === 1) return <ToolCallCard activity={activities[0]} sessionId={sessionId} />;
  const noun = isScriptCall(activities[0]) ? "脚本" : "工具";
  const statuses = activities.map(activity => activity.executionStatus ?? activity.status);
  const failed = statuses.some(status => ["failed", "timed_out", "outcome_unknown", "conflict", "rejected", "expired"].includes(status));
  const pending = statuses.some(status => ["queued", "running", "waiting_confirmation"].includes(status));
  const summary = `${pending ? "正在运行" : "运行了"}${noun}`;
  const statusText = [pending ? "执行中" : "", failed ? "有异常" : ""].filter(Boolean).join(" · ");

  return (
    <div className="min-w-0 rounded-xl bg-surface text-foreground shadow-sm">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-3 text-left text-xs transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary">
        <Code className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{summary}<span className="ml-2 font-normal tabular-nums text-muted">{activities.length} 次</span></span>
        {statusText ? <span className={`shrink-0 ${failed ? "text-danger" : "text-muted"}`}>{statusText}</span> : null}
        <span className={`size-1.5 shrink-0 rounded-full ${failed ? "bg-danger" : pending ? "animate-pulse bg-warning motion-reduce:animate-none" : statuses.every(status => ["succeeded", "completed"].includes(status)) ? "bg-success" : "bg-muted"}`} aria-hidden="true" />
        <ArrowChevronDown className={`size-3.5 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open}>
        {open ? <div className="flex min-w-0 flex-col gap-2 px-3 pb-3">
          {activities.map(activity => <ToolCallCard key={activity.id} activity={activity} sessionId={sessionId} />)}
        </div> : null}
      </div>
    </div>
  );
}
