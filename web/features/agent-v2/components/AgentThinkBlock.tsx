"use client";

import { ArrowChevronDown, FaceRobot } from "@gravity-ui/icons";
import { useId, useState } from "react";
import { AgentMarkdown } from "./AgentMarkdown";

export function ThinkBlock({ text, running = false }: { text: string; index: number; running?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const firstLine = text.split(/\r?\n/).find(line => line.trim())?.trim() ?? "模型提供的思考摘要";
  return <div className="min-w-0 rounded-xl bg-surface text-foreground shadow-sm">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-3 text-left text-xs transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary">
      <FaceRobot className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="shrink-0 text-muted">{running ? "正在思考" : "思考摘要"}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{firstLine}</span>
      <span className={`size-1.5 shrink-0 rounded-full ${running ? "animate-pulse bg-warning motion-reduce:animate-none" : "bg-muted"}`} aria-hidden="true" />
      <ArrowChevronDown className={`size-3.5 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    <div id={panelId} hidden={!open}>{open && <div className="min-w-0 px-3 pb-3 text-sm text-muted"><AgentMarkdown content={text} /></div>}</div>
  </div>;
}
