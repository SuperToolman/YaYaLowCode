import type { AutomationFlow } from "@/features/automation-editor/api";

export type TriggerEvent = AutomationFlow["triggerEvents"][number];
export type ManualTriggerEvent = Exclude<TriggerEvent, "form_submit">;
export type AutomationStatus = AutomationFlow["status"];

export type AutomationManagementType = "trigger" | "manual" | "process";

export function getAutomationManagementType(
  flow: Pick<AutomationFlow, "flowType" | "triggerEvents">,
): AutomationManagementType {
  if (flow.flowType === "process") return "process";
  return flow.triggerEvents.includes("button_click") ? "manual" : "trigger";
}

export const automationTypeLabels: Record<AutomationManagementType, string> = {
  trigger: "触发类型",
  manual: "手动类型",
  process: "流程类型",
};

export const triggerEvents: Array<{ id: ManualTriggerEvent; label: string }> = [
  { id: "button_click", label: "按钮触发" },
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
    label: "已启动",
    className: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    dotClassName: "bg-[var(--color-success)]",
  },
  paused: {
    label: "已停止",
    className: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
    dotClassName: "bg-[var(--color-text-disabled)]",
  },
};

export const fallbackStatusMeta = {
  label: "未知状态",
  className: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
  dotClassName: "bg-[var(--color-text-disabled)]",
} satisfies (typeof statusMeta)[AutomationStatus];
