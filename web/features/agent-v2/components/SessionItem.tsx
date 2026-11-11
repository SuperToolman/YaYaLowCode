"use client";

import { ArrowRotateRight, CircleExclamation, Pin } from "@gravity-ui/icons";
import { Label, ListBox } from "@heroui/react";
import type { Session } from "../client";

// Workbench session presentation adapted to the V2 directory contract.
export function SessionItem({ session }: { session: Session }) {
  const running = ["queued", "running", "retry_wait", "waiting_confirmation", "cancel_requested"].includes(session.run_status ?? "");
  return <>
    {session.pinned && <Pin className="size-3 shrink-0" aria-label="已置顶" />}
    <Label className="min-w-0 flex-1 truncate">{session.title || "新对话"}</Label>
    {running && <ArrowRotateRight className="size-3 shrink-0 animate-spin" aria-label="会话正在运行" />}
    {session.run_status === "failed" && <CircleExclamation aria-label="会话执行失败" />}
    <ListBox.ItemIndicator />
  </>;
}
