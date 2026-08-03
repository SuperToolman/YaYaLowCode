"use client";

import { Button, Dropdown, Input, ListBox, Select } from "@heroui/react";
import { AddIcon, TrashIcon } from "../../../../components/app-icons";
import {
  branchOperatorLabel,
  branchOperators,
  type BranchRule,
  type BranchRuleOperator,
  type SourceFieldChoice,
} from "./automation-editor-model";
import { IconActionButton, SourceFieldSelect } from "./automation-node-config-primitives";

export function BranchRulesEditor({
  allowFieldValues = true,
  rules,
  sourceFieldChoices,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  allowFieldValues?: boolean;
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  onAddConditionRule: (parentId?: string, siblingOfId?: string, count?: number) => void;
  onConditionRuleChange: (ruleId: string, key: keyof BranchRule, value: string) => void;
  onRemoveConditionRule: (ruleId: string) => void;
}) {
  const rootRules = rules.filter((rule) => !rule.parentId);

  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text-primary)]">条件规则</div>
          <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">同级条件通过“且 / 或”连接；子级条件作为当前条件的嵌套条件组。</div>
        </div>
        <Button
          variant="secondary"
          className="h-8 shrink-0 rounded-md px-2.5 text-xs"
          onClick={() => onAddConditionRule()}
        >
          <AddIcon />
          添加根条件
        </Button>
      </div>
      <div className="automation-rule-horizontal-scroll w-full max-w-full overflow-x-auto pb-2">
        <div className="w-max min-w-[590px] space-y-4 pr-1">
          {rootRules.length > 0 ? (
            <div
              className={
                rootRules.length > 1
                  ? "relative ml-8 w-max min-w-[568px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-4 pl-8"
                  : ""
              }
            >
              {rootRules.length > 1 ? (
                <Select
                  aria-label="根条件组逻辑关系"
                  className="absolute -left-8 top-1/2 z-10 w-16 -translate-y-1/2"
                  selectedKey={rootRules[0]?.logicalOperator ?? "and"}
                  onSelectionChange={(key) =>
                    onConditionRuleChange(
                      rootRules[0]?.id ?? "",
                      "logicalOperator",
                      String(key ?? "and"),
                    )
                  }
                >
                  <Select.Trigger>
                    <Select.Value>{rootRules[0]?.logicalOperator === "or" ? "或" : "且"}</Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="and" textValue="且">且</ListBox.Item>
                      <ListBox.Item id="or" textValue="或">或</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              ) : null}
              {rootRules.length > 1 ? (
                <span className="absolute -left-3 top-1/2 h-px w-3 bg-[var(--color-border)]" />
              ) : null}
              <div className="space-y-4">
                {rootRules.map((rule) => (
                  <BranchRuleItem
                    key={rule.id}
                    allowFieldValues={allowFieldValues}
                    rule={rule}
                    rules={rules}
                    sourceFieldChoices={sourceFieldChoices}
                    onAddConditionRule={onAddConditionRule}
                    onConditionRuleChange={onConditionRuleChange}
                    onRemoveConditionRule={onRemoveConditionRule}
                  />
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              onClick={() => onAddConditionRule()}
            >
              添加第一条条件
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BranchRuleItem({
  allowFieldValues,
  rule,
  rules,
  sourceFieldChoices,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  allowFieldValues: boolean;
  rule: BranchRule;
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  onAddConditionRule: (parentId?: string, siblingOfId?: string, count?: number) => void;
  onConditionRuleChange: (ruleId: string, key: keyof BranchRule, value: string) => void;
  onRemoveConditionRule: (ruleId: string) => void;
}) {
  const selectedField = sourceFieldChoices.find((item) => item.key === rule.fieldKey);
  const childRules = rules.filter((item) => item.parentId === rule.id);
  // Structural groups are invisible in the editor and must not make a level
  // eligible for nesting on their own.
  const siblingRules = rules.filter(
    (item) => item.parentId === rule.parentId && !item.isGroup,
  );
  const operator = rule.operator ?? "eq";
  const hideValue = operator === "hasValue" || operator === "noValue";
  const valueType = rule.valueType ?? "value";

  return (
    <div className="w-max min-w-full space-y-4">
      {!rule.isGroup ? <div className="relative flex w-max min-w-full items-center gap-2">
        <div className="grid min-w-[520px] shrink-0 grid-cols-[140px_80px_72px_130px_28px_28px] items-center gap-2">
            <SourceFieldSelect
              options={sourceFieldChoices}
              value={rule.fieldKey ?? ""}
              onChange={(value) => onConditionRuleChange(rule.id, "fieldKey", value)}
            />
            <Select
              aria-label="条件运算符"
              selectedKey={operator}
              onSelectionChange={(key) =>
                onConditionRuleChange(
                  rule.id,
                  "operator",
                  String(key ?? "eq"),
                )
              }
            >
              <Select.Trigger>
                <Select.Value>{branchOperatorLabel(operator)}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {branchOperators.map((item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {hideValue ? (
              <>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">无需值</div>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">—</div>
              </>
            ) : (
              <>
                {allowFieldValues ? (
                  <Select
                    aria-label="条件值类型"
                    selectedKey={valueType}
                    onSelectionChange={(key) =>
                      onConditionRuleChange(rule.id, "valueType", String(key ?? "value"))
                    }
                  >
                    <Select.Trigger>
                      <Select.Value>{valueType === "field" ? "字段" : "值"}</Select.Value>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="value" textValue="值">值</ListBox.Item>
                        <ListBox.Item id="field" textValue="字段">字段</ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">
                    值
                  </div>
                )}
                {allowFieldValues && valueType === "field" ? (
                  <SourceFieldSelect
                    options={sourceFieldChoices}
                    value={rule.sourceFieldKey ?? ""}
                    onChange={(value) =>
                      onConditionRuleChange(rule.id, "sourceFieldKey", value)
                    }
                  />
                ) : (
                  <BranchRuleValueInput
                    field={selectedField}
                    operator={operator}
                    value={rule.rawValue ?? ""}
                    onChange={(value) => onConditionRuleChange(rule.id, "rawValue", value)}
                  />
                )}
              </>
            )}
            <IconActionButton
              ariaLabel="删除条件规则"
              danger
              onClick={() => onRemoveConditionRule(rule.id)}
            >
              <TrashIcon />
            </IconActionButton>
            <Dropdown>
              <Dropdown.Trigger
                aria-label="添加条件规则"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-primary)]"
              >
                <AddIcon />
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="添加条件规则"
                  onAction={(key) => {
                    if (key === "child") {
                      if (siblingRules.length < 2) {
                        onAddConditionRule(rule.parentId, rule.id);
                      } else if (childRules.length > 0) {
                        onAddConditionRule(rule.id);
                      } else {
                        onAddConditionRule(rule.id, undefined, 0);
                      }
                    } else {
                      onAddConditionRule(rule.parentId, rule.id);
                    }
                  }}
                >
                  <Dropdown.Item id="sibling">添加同级条件</Dropdown.Item>
                  <Dropdown.Item id="child">添加子级条件</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
        </div>
      </div> : null}

      {childRules.length > 0 ? (
        <div className={`relative ml-8 w-max min-w-[568px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-4 pl-8 ${rule.isGroup ? "mt-0" : "mt-5"}`}>
          <Select
            aria-label="父级与子级条件组的逻辑关系"
            className="absolute -left-8 top-1/2 z-10 w-16 -translate-y-1/2"
            selectedKey={childRules[0]?.logicalOperator ?? "and"}
            onSelectionChange={(key) =>
              onConditionRuleChange(
                childRules[0]?.id ?? "",
                "logicalOperator",
                String(key ?? "and"),
              )
            }
          >
            <Select.Trigger>
              <Select.Value>
                {childRules[0]?.logicalOperator === "or" ? "或" : "且"}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="and" textValue="且">且</ListBox.Item>
                <ListBox.Item id="or" textValue="或">或</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <span className="absolute -left-3 top-1/2 h-px w-3 bg-[var(--color-border)]" />
          <div className="space-y-4">
            {childRules.map((child) => (
              <BranchRuleItem
                key={child.id}
                allowFieldValues={allowFieldValues}
                rule={child}
                rules={rules}
                sourceFieldChoices={sourceFieldChoices}
                onAddConditionRule={onAddConditionRule}
                onConditionRuleChange={onConditionRuleChange}
                onRemoveConditionRule={onRemoveConditionRule}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchRuleValueInput({
  field,
  operator,
  value,
  onChange,
}: {
  field?: SourceFieldChoice;
  operator: BranchRuleOperator;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field?.options.length && (field.fieldType === "select" || field.fieldType === "radio")) {
    if (operator === "inAny" || operator === "notInAny") {
      return (
        <Input
          aria-label="匹配值"
          className="h-9 min-h-9"
          placeholder="多个选项值用逗号分隔"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    }

    return (
      <Select
        aria-label="匹配值"
        selectedKey={value || "none"}
        onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
      >
        <Select.Trigger>
          <Select.Value>
            {field.options.find((option) => option.value === value)?.label ?? "选择匹配值"}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="none" textValue="未配置">
              未配置
            </ListBox.Item>
            {field.options.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  if (field?.fieldType === "multiLineText" || field?.fieldType === "description") {
    return (
      <textarea
        className="min-h-[84px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
        placeholder={operator === "inAny" || operator === "notInAny" ? "多个值用逗号分隔" : "输入匹配值"}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <Input
      aria-label="匹配值"
      className="h-9 min-h-9"
      placeholder={operator === "inAny" || operator === "notInAny" ? "多个值用逗号分隔" : "输入匹配值"}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

