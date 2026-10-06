"use client";

import { Button } from "@heroui/react";
import type { PatchOperation, ValidationIssue } from "@/app/lib/agent-development-contracts";

export type AgentDevelopmentPatchPreviewProps = {
  patch: PatchOperation[];
  issues?: ValidationIssue[];
  baseVersion?: number | null;
  onConfirm: () => void;
  onCancel?: () => void;
  confirming?: boolean;
};

export function AgentDevelopmentPatchPreview({ patch, issues = [], baseVersion, onConfirm, onCancel = () => {}, confirming = false }: AgentDevelopmentPatchPreviewProps) {
  const valid = issues.length === 0;
  return <section className="space-y-3 border-y border-[var(--color-border)] py-3" aria-label="Agent 配置变更预览">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">配置变更预览</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">{baseVersion == null ? "当前版本未知" : `基于版本 ${baseVersion}`}，共 {patch.length} 项变更</p>
      </div>
      <span className={valid ? "text-xs text-[var(--color-success)]" : "text-xs text-[var(--color-danger)]"}>{valid ? "校验通过" : `${issues.length} 个问题`}</span>
    </div>
    <ul className="space-y-1 font-mono text-xs" aria-label="Patch 列表">
      {patch.map((operation, index) => <li key={`${operation.op}-${operation.path}-${index}`} className="rounded-md bg-[var(--color-control-soft)] px-2 py-1"><span className="mr-2 font-semibold">{operation.op.toUpperCase()}</span><span>{operation.path}</span>{operation.value !== undefined ? <span className="ml-2 text-[var(--color-text-secondary)]">{JSON.stringify(operation.value)}</span> : null}</li>)}
    </ul>
    {issues.length ? <ul className="space-y-1 text-xs text-[var(--color-danger)]" aria-label="校验问题">{issues.map((item) => <li key={`${item.path}-${item.code}`}><span className="font-mono">{item.path}</span>：{item.message}{item.suggestion ? `（${item.suggestion}）` : ""}</li>)}</ul> : null}
    <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onPress={onCancel}>取消</Button><Button size="sm" variant="primary" isDisabled={!valid || confirming} onPress={onConfirm}>{confirming ? "保存中..." : "确认并保存"}</Button></div>
  </section>;
}
