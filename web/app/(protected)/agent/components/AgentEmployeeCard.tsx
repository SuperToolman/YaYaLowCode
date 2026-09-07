"use client";

import { FaceRobot } from "@gravity-ui/icons";
import { useState } from "react";
import type { AgentOption } from "@/features/agent-assistant/types";
import { MySurface } from "../../../components/my-surface";

export function AgentEmployeeCard({ employee, selected, disabled, onSelect }: { employee: AgentOption; selected: boolean; disabled?: boolean; onSelect: () => void }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUrl = employee.avatarUrl || `/api/ai-employees/${encodeURIComponent(employee.id)}/avatar`;
  return <button type="button" className="block w-full text-left" disabled={disabled} aria-pressed={selected} onClick={onSelect}>
    <MySurface className={`flex flex-col items-center gap-1 px-1.5 py-2.5 transition-colors ${selected ? "text-accent" : "text-foreground"}`}>
      {avatarFailed ? <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent"><FaceRobot className="size-4" /></span> : <img src={avatarUrl} alt={`${employee.name}头像`} className="size-8 shrink-0 rounded-lg object-cover" onError={() => setAvatarFailed(true)} />}
      <span className="line-clamp-2 w-full break-words text-center text-[11px] font-medium">{employee.name}</span>
    </MySurface>
  </button>;
}
