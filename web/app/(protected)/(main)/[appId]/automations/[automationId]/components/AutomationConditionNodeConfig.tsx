"use client";

import { useState } from "react";
import { Button, ListBox, Select } from "@heroui/react";
import {
  Plus as AddIcon,
  ArrowDown as ArrowDownIcon,
  ArrowUp as ArrowUpIcon,
  TrashBin as TrashIcon,
} from "@gravity-ui/icons";
import {
  branchModeLabel,
  normalizeConditionConfig,
  type SourceFieldChoice,
  type WorkflowNode,
} from "../automation-editor-model";
import type { BranchRule } from "@/features/automation-editor/condition-rules";
import { BranchRulesEditor } from "./AutomationConditionRuleEditor";
import { WorkflowConfigGroup } from "@components/workflow-editor/WorkflowConfigGroup";
import {
  IconActionButton,
  PropertyField,
  TextAreaInput,
} from "./AutomationNodeConfigPrimitives";

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
  onAddConditionRule: (
    branchId: string,
    parentId?: string,
    siblingOfId?: string,
    count?: number,
  ) => void;
  onConditionBranchChange: (
    branchId: string,
    key: "name" | "expression",
    value: string,
  ) => void;
  onConditionModeChange: (
    branchId: string,
    value: "all" | "rules" | "expression" | "otherwise",
  ) => void;
  onConditionRuleChange: (
    branchId: string,
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) => void;
  onMoveConditionBranch: (branchId: string, direction: "up" | "down") => void;
  onRemoveConditionBranch: (branchId: string) => void;
  onRemoveConditionRule: (branchId: string, ruleId: string) => void;
  sourceFieldChoices: SourceFieldChoice[];
}) {
  const [editingConditionBranchId, setEditingConditionBranchId] = useState<
    string | null
  >(null);
  if (
    node.data.kind === "condition" ||
    node.data.kind === "parallel-condition"
  ) {
    const config = normalizeConditionConfig(node.data.config);
    const branches = config.branches ?? [];
    return (
      <div className="space-y-4">
        {branches.map((branch, index) => (
          <WorkflowConfigGroup
            key={branch.id}
            title={
              editingConditionBranchId === branch.id ? (
                <input
                  autoFocus
                  aria-label={`条件分支 ${index + 1} 名称`}
                  className="h-8 w-full rounded-md border border-[var(--color-primary)] bg-[var(--color-bg-surface)] px-2 text-sm font-semibold text-[var(--color-text-primary)] outline-none"
                  value={branch.name}
                  onBlur={() => setEditingConditionBranchId(null)}
                  onChange={(event) =>
                    onConditionBranchChange(
                      branch.id,
                      "name",
                      event.currentTarget.value,
                    )
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
              )
            }
            actions={
              <div className="flex items-center justify-end gap-1">
                {node.data.kind !== "parallel-condition" ? (
                  <>
                    <IconActionButton
                      ariaLabel="上移条件分支"
                      isDisabled={
                        branch.entryMode === "otherwise" || index === 0
                      }
                      onClick={() => onMoveConditionBranch(branch.id, "up")}
                    >
                      <ArrowUpIcon />
                    </IconActionButton>
                    <IconActionButton
                      ariaLabel="下移条件分支"
                      isDisabled={
                        branch.entryMode === "otherwise" ||
                        index === branches.length - 1 ||
                        branches[index + 1]?.entryMode === "otherwise"
                      }
                      onClick={() => onMoveConditionBranch(branch.id, "down")}
                    >
                      <ArrowDownIcon />
                    </IconActionButton>
                  </>
                ) : null}
                <IconActionButton
                  ariaLabel="删除条件分支"
                  danger
                  isDisabled={branches.length <= 1}
                  onClick={() => onRemoveConditionBranch(branch.id)}
                >
                  <TrashIcon />
                </IconActionButton>
              </div>
            }
          >
            <PropertyField label="进入方式">
              <Select
                aria-label={`条件分支 ${index + 1} 进入方式`}
                selectedKey={
                  branch.entryMode === "otherwise" ? "otherwise" : branch.mode
                }
                disabledKeys={
                  branches.some(
                    (item) =>
                      item.id !== branch.id && item.entryMode === "otherwise",
                  )
                    ? ["otherwise"]
                    : []
                }
                onSelectionChange={(key) => {
                  const value = String(key ?? "all");
                  onConditionModeChange(
                    branch.id,
                    value as "all" | "rules" | "expression" | "otherwise",
                  );
                }}
              >
                <Select.Trigger>
                  <Select.Value>
                    {branch.entryMode === "otherwise"
                      ? "否则进入"
                      : branchModeLabel(branch.mode)}
                  </Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="otherwise" textValue="否则进入">
                      否则进入
                    </ListBox.Item>
                    <ListBox.Item id="all" textValue="所有数据均可通过">
                      所有数据均可通过
                    </ListBox.Item>
                    <ListBox.Item id="rules" textValue="按条件规则进入">
                      按条件规则进入
                    </ListBox.Item>
                    <ListBox.Item id="expression" textValue="按表达式进入">
                      按表达式进入
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </PropertyField>
            {branch.entryMode !== "otherwise" && branch.mode === "rules" ? (
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

            {branch.entryMode !== "otherwise" &&
            branch.mode === "expression" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-[var(--color-text-primary)]">
                  表达式
                </div>
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
          </WorkflowConfigGroup>
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
