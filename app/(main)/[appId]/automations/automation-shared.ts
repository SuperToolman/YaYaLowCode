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
    className: "bg-[#eaf8f0] text-[#16864b]",
    dotClassName: "bg-[#17b466]",
  },
  paused: {
    label: "已停用",
    className: "bg-[#f2f5fb] text-[#60718a]",
    dotClassName: "bg-[#9aa9be]",
  },
  draft: {
    label: "草稿",
    className: "bg-[#fff6df] text-[#a36a08]",
    dotClassName: "bg-[#f0a516]",
  },
};
