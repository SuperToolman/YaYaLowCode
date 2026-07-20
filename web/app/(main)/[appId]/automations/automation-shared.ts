import type { AutomationFlow } from "../../../lib/api-client";

export type TriggerEvent = AutomationFlow["triggerEvent"];
export type AutomationStatus = AutomationFlow["status"];

export const triggerEvents: Array<{ id: TriggerEvent; label: string }> = [
  { id: "after_create", label: "创建成功后" },
  { id: "before_create", label: "创建成功前" },
  { id: "after_update", label: "编辑成功后" },
  { id: "before_update", label: "编辑成功前" },
  { id: "after_delete", label: "删除成功后" },
  { id: "before_delete", label: "删除成功前" },
];

export const statusMeta: Record<
  AutomationStatus,
  { label: string; className: string; dotClassName: string }
> = {
  enabled: {
    label: "已启用",
    className: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    dotClassName: "bg-[var(--color-success)]",
  },
  paused: {
    label: "已停用",
    className: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
    dotClassName: "bg-[var(--color-text-disabled)]",
  },
  draft: {
    label: "草稿",
    className: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    dotClassName: "bg-[var(--color-warning)]",
  },
};
