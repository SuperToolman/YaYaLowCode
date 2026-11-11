"use client";

import { Avatar } from "@heroui/react";
import type { Employee } from "../client";

// Keeps the platform employee/avatar service, independent of either Agent runtime.
export function AgentEmployeeAvatar({ employee, compact = false }: { employee: Employee; compact?: boolean }) {
  return <Avatar size="sm" className={compact ? "size-4" : undefined}>
    <Avatar.Image src={`/api/ai-employees/${encodeURIComponent(employee.id)}/avatar`} alt={`${employee.title}的头像`} />
    <Avatar.Fallback>{employee.title.trim().slice(0, 1) || "?"}</Avatar.Fallback>
  </Avatar>;
}
