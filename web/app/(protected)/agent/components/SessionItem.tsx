"use client";

import { Pencil, TrashBin } from "@gravity-ui/icons";
import { Button, Input } from "@heroui/react";
import { useState } from "react";
import type { AgentSession } from "@/features/agent-assistant/types";

export function SessionItem({ session, selected, disabled, onSelect, onDelete, onRename }: { session: AgentSession; selected?: boolean; disabled?: boolean; onSelect: () => void; onDelete: () => void; onRename: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title || "新对话");

  async function saveRename() {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === (session.title || "新对话")) { setEditing(false); return; }
    await onRename(nextTitle);
    setEditing(false);
  }

  if (editing) return <div className={`flex h-11 min-h-11 w-full items-center gap-1 rounded-lg px-1 ${selected ? "bg-accent/12" : "bg-default/70"}`}>
    <Input aria-label="会话名称" autoFocus value={title} onChange={(event) => setTitle(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveRename(); if (event.key === "Escape") setEditing(false); }} className="min-w-0 flex-1" />
    <Button size="sm" aria-label="保存会话名称" isDisabled={disabled || !title.trim()} onPress={() => void saveRename()}>保存</Button>
  </div>;

  return <div role="button" tabIndex={disabled ? -1 : 0} aria-current={selected ? "page" : undefined} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} className={`group flex h-11 min-h-11 w-full cursor-pointer items-center gap-1 rounded-lg px-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus ${selected ? "bg-accent/12 text-accent" : "text-foreground hover:bg-default/70"}`}>
    <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || "新对话"}</span>
    <Button isIconOnly size="sm" aria-label="重命名会话" className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100" isDisabled={disabled} onPress={(event) => { event.continuePropagation(); setTitle(session.title || "新对话"); setEditing(true); }}><Pencil /></Button>
    <Button isIconOnly size="sm" aria-label="删除会话" className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100" isDisabled={disabled} onPress={(event) => { event.continuePropagation(); onDelete(); }}><TrashBin /></Button>
  </div>;
}
