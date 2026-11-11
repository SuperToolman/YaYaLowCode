"use client";

import { Tag, TagGroup } from "@heroui/react";

const tones = {
  neutral: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
  info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  primary: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
};
type Tone = keyof typeof tones;
const approvalTones: Record<string, Tone> = {
  saved: "neutral", reviewing: "info", approved: "success", rejected: "danger",
};
const instanceTones: Record<string, Tone> = {
  not_started: "neutral", in_progress: "neutral", running: "info",
  paused: "warning", completed: "success", failed: "danger",
};

export function WorkflowBuiltinTag({ fieldId, label, value, instanceStatus }: {
  fieldId: string;
  label: string;
  value: unknown;
  instanceStatus: unknown;
}) {
  if (!label) return null;
  const tone = fieldId === "workflowApprovalStatus"
    ? approvalTones[String(value)] ?? "neutral"
    : fieldId === "workflowInstanceStatus"
      ? instanceTones[String(value)] ?? "neutral"
      : instanceTones[String(instanceStatus)] ?? "primary";
  return (
    <TagGroup aria-label={fieldId === "workflowApprovalStatus" ? "审批状态" : fieldId === "workflowInstanceStatus" ? "实例状态" : "当前审批节点"} size="sm" className="min-w-0">
      <TagGroup.List>
        <Tag id="status" textValue={label} className={`max-w-full cursor-default ${tones[tone]}`}>
          <span className="truncate" title={label}>{label}</span>
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}
