"use client";

import { ArrowRotateRight, Check, CircleXmark, Pencil, TrashBin } from "@gravity-ui/icons";
import { Button, Input } from "@heroui/react";
import type { AgentRunStatus, AgentSession } from "@/features/agent-assistant/types";

export function SessionItem({ session, selected, disabled, runStatus = "completed", editing = false, editTitle, onEditStart, onEditTitleChange, onEditCancel, onSelect, onDelete, onRename }: { session: AgentSession; selected?: boolean; disabled?: boolean; runStatus?: AgentRunStatus; editing?: boolean; editTitle?: string; onEditStart: () => void; onEditTitleChange: (title: string) => void; onEditCancel: () => void; onSelect: () => void; onDelete: () => void; onRename: (title: string) => Promise<void> }) {
  async function saveRename() {
    const nextTitle = (editTitle ?? (session.title || "新对话")).trim();
    if (!nextTitle || nextTitle === (session.title || "新对话")) { onEditCancel(); return; }
    await onRename(nextTitle);
    onEditCancel();
  }

  if (editing) return <div className={`flex h-11 min-h-11 w-full items-center gap-1 rounded-lg px-1 ${selected ? "bg-accent/12" : "bg-default/70"}`}>
    <Input aria-label="会话名称" autoFocus value={editTitle ?? (session.title || "新对话")} onChange={(event) => onEditTitleChange(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveRename(); if (event.key === "Escape") onEditCancel(); }} className="min-w-0 flex-1" />
    <Button isIconOnly size="sm" variant="ghost" aria-label="保存会话名称" isDisabled={disabled || !(editTitle ?? (session.title || "新对话")).trim()} onPress={() => void saveRename()}><Check /></Button>
    <Button isIconOnly size="sm" variant="ghost" aria-label="取消编辑会话名称" isDisabled={disabled} onPress={onEditCancel}><CircleXmark /></Button>
  </div>;

  return <div role="button" tabIndex={disabled ? -1 : 0} aria-current={selected ? "page" : undefined} onClick={() => { if (!disabled) onSelect(); }} onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(); } }} className={`group relative flex min-h-12 w-full cursor-pointer items-center rounded-lg px-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus ${selected ? "bg-accent/12 text-accent" : "text-foreground hover:bg-default/70"}`}>
    <span className="flex min-w-0 flex-1 items-center gap-1"><span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || "新对话"}</span><SessionStatus status={runStatus} /></span>
    <div className="absolute right-1 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      <Button isIconOnly size="sm" variant="ghost" aria-label="重命名会话" isDisabled={disabled} onPress={(event) => { event.continuePropagation(); onEditStart(); }}><Pencil /></Button>
      <Button isIconOnly size="sm" variant="ghost" aria-label="删除会话" isDisabled={disabled} onPress={(event) => { event.continuePropagation(); onDelete(); }}><TrashBin /></Button>
    </div>
  </div>;
}

function SessionStatus({ status }: { status: AgentRunStatus }) {
  if (status !== "thinking" && status !== "working" && status !== "responding") return null;
  return <ArrowRotateRight className="size-3 shrink-0 animate-spin text-accent" aria-label="会话正在运行" />;
}
