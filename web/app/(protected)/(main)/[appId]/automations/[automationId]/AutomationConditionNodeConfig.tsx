"use client";

import { useState } from "react";
import { Button, Input, ListBox, Select } from "@heroui/react";
import { Plus as AddIcon, ArrowDown as ArrowDownIcon, ArrowUp as ArrowUpIcon, TrashBin as TrashIcon } from "@gravity-ui/icons";
import {
  branchModeLabel,
  normalizeConditionConfig,
  type BranchRule,
  type SourceFieldChoice,
  type WorkflowNode,
} from "./automation-editor-model";
import { BranchRulesEditor } from "./AutomationConditionRuleEditor";
import { IconActionButton, PropertyField, TextAreaInput } from "./AutomationNodeConfigPrimitives";

export function ConditionNodeConfig({
  node,
  onAddConditionBranch,
  onAddConditionRule,
  onConditionBranchChange,
  onConditionModeChange,
  onConditionRuleChange,
  onMoveConditionBranch,
  onRemoveConditionBranch,
  onRemoveConditionRule,
  sourceFieldChoices,
}: {
  node: WorkflowNode;
  onAddConditionBranch: () => void;
  onAddConditionRule: (branchId: string, parentId?: string, siblingOfId?: string, count?: number) => void;
  onConditionBranchChange: (branchId: string, key: "name" | "hitLabel" | "expression", value: string) => void;
  onConditionModeChange: (branchId: string, value: "all" | "rules" | "expression") => void;
  onConditionRuleChange: (branchId: string, ruleId: string, key: keyof BranchRule, value: string) => void;
  onMoveConditionBranch: (branchId: string, direction: "up" | "down") => void;
  onRemoveConditionBranch: (branchId: string) => void;
  onRemoveConditionRule: (branchId: string, ruleId: string) => void;
  sourceFieldChoices: SourceFieldChoice[];
}) {
  const [editingConditionBranchId, setEditingConditionBranchId] = useState<string | null>(null);
if (node.data.kind === "condition") {
  const config = normalizeConditionConfig(node.data.config);
  const branches = config.branches ?? [];
  return (
    <div className="space-y-4">
      {branches.map((branch, index) => (
        <div
          key={branch.id}
          className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)]"
        >
          <div className="flex min-h-11 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-3 py-2">
            <div className="min-w-0 flex-1">
              {editingConditionBranchId === branch.id ? (
                <input
                  autoFocus
                  aria-label={`条件分支 ${index + 1} 名称`}
                  className="h-8 w-full rounded-md border border-[var(--color-primary)] bg-[var(--color-bg-surface)] px-2 text-sm font-semibold text-[var(--color-text-primary)] outline-none"
                  value={branch.name}
                  onBlur={() => setEditingConditionBranchId(null)}
                  onChange={(event) =>
                    onConditionBranchChange(branch.id, "name", event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Escape") {
                      setEditingConditionBranchId(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="max-w-full truncate rounded px-1 py-1 text-left text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-control-soft-hover)]"
                  onClick={() => setEditingConditionBranchId(branch.id)}
                >
                  {branch.name || `条件分支 ${index + 1}`}
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconActionButton
                ariaLabel="上移条件分支"
                isDisabled={index === 0}
                onClick={() => onMoveConditionBranch(branch.id, "up")}
              >
                <ArrowUpIcon />
              </IconActionButton>
              <IconActionButton
                ariaLabel="下移条件分支"
                isDisabled={index === branches.length - 1}
                onClick={() => onMoveConditionBranch(branch.id, "down")}
              >
                <ArrowDownIcon />
              </IconActionButton>
              <IconActionButton
                ariaLabel="删除条件分支"
                danger
                isDisabled={branches.length <= 1}
                onClick={() => onRemoveConditionBranch(branch.id)}
              >
                <TrashIcon />
              </IconActionButton>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <PropertyField label="进入方式">
              <Select
                aria-label={`条件分支 ${index + 1} 进入方式`}
                selectedKey={branch.mode}
                onSelectionChange={(key) =>
                  onConditionModeChange(
                    branch.id,
                    String(key ?? "all") as "all" | "rules" | "expression",
                  )
                }
              >
                <Select.Trigger>
                  <Select.Value>{branchModeLabel(branch.mode)}</Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all" textValue="所有数据均可通过">所有数据均可通过</ListBox.Item>
                    <ListBox.Item id="rules" textValue="按条件规则进入">按条件规则进入</ListBox.Item>
                    <ListBox.Item id="expression" textValue="按表达式进入">按表达式进入</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </PropertyField>
            <PropertyField label="命中说明">
              <Input
                aria-label={`条件分支 ${index + 1} 命中说明`}
                placeholder={`例如：分支 ${index + 1} 满足审批条件`}
                value={branch.hitLabel}
                onChange={(event) =>
                  onConditionBranchChange(branch.id, "hitLabel", event.currentTarget.value)
                }
              />
            </PropertyField>

            {branch.mode === "all" ? (
              <div className="rounded-lg bg-[var(--color-info-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-info)]">
              当前分支默认放行所有流转到该条件节点的数据。
              </div>
            ) : null}

            {branch.mode === "rules" ? (
              <BranchRulesEditor
                rules={branch.rules}
                sourceFieldChoices={sourceFieldChoices}
                onAddConditionRule={(parentId, siblingOfId, count) =>
                  onAddConditionRule(branch.id, parentId, siblingOfId, count)
                }
                onConditionRuleChange={(ruleId, key, value) =>
                  onConditionRuleChange(branch.id, ruleId, key, value)
                }
                onRemoveConditionRule={(ruleId) =>
                  onRemoveConditionRule(branch.id, ruleId)
                }
              />
            ) : null}

            {branch.mode === "expression" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-[var(--color-text-primary)]">表达式</div>
              <TextAreaInput
                ariaLabel={`条件分支 ${index + 1} 表达式`}
                placeholder="输入表达式，例如 前置节点.状态 == '已完成'"
                value={branch.expression}
                onChange={(value) =>
                  onConditionBranchChange(branch.id, "expression", value)
                }
              />
              </div>
            ) : null}
          </div>
        </div>
      ))}

      <Button
        variant="ghost"
        className="h-10 w-full rounded-lg border border-dashed border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
        onClick={onAddConditionBranch}
      >
        <AddIcon />
        添加分支
      </Button>
    </div>
  );
}


  return null;
}
