"use client";

import {
  Button,
  ButtonGroup,
  Dropdown,
  Input,
  ListBox,
  Select,
} from "@heroui/react";
import { Plus as AddIcon, TrashBin as TrashIcon } from "@gravity-ui/icons";
const branchOperatorLabel = (operator: BranchRuleOperator) => branchOperators.find((item) => item.id === operator)?.label ?? "等于";
import {
  branchOperators,
  type BranchRule,
  type BranchRuleOperator,
} from "@/features/automation-editor/condition-rules";
import type { SourceFieldChoice } from "@/features/automation-editor/condition-rules";
import { FieldSelect, type FieldSelectOption } from "@/components/FieldSelect";
function SourceFieldSelect({ options, value, onChange }: { options: readonly FieldSelectOption[]; value: string; onChange: (value: string) => void }) { return <FieldSelect options={options} value={value} onChange={onChange} ariaLabel="来源字段" placeholder="" />; }


export function BranchRulesEditor({
  rules,
  sourceFieldChoices,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  onAddConditionRule: (
    parentId?: string,
    siblingOfId?: string,
    count?: number,
  ) => void;
  onConditionRuleChange: (
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) => void;
  onRemoveConditionRule: (ruleId: string) => void;
}) {
  const rootRules = rules.filter((rule) => !rule.parentId);

  return (
    <div className="space-y-2">
      <div
        className={`w-full max-w-full overflow-x-auto rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] ${rootRules.length > 0 ? "p-3" : "transition-colors hover:border-[var(--color-primary)]"}`}
      >
        <div className={rootRules.length > 0 ? "w-max min-w-[590px] space-y-4" : "w-full"}>
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
                    <Select.Value>
                      {rootRules[0]?.logicalOperator === "or" ? "或" : "且"}
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover className="rounded-lg">
                    <ListBox>
                      <ListBox.Item id="and" textValue="且">
                        且
                      </ListBox.Item>
                      <ListBox.Item id="or" textValue="或">
                        或
                      </ListBox.Item>
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
              className="w-full px-3 py-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-primary)]"
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
  rule,
  rules,
  sourceFieldChoices,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  rule: BranchRule;
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  onAddConditionRule: (
    parentId?: string,
    siblingOfId?: string,
    count?: number,
  ) => void;
  onConditionRuleChange: (
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) => void;
  onRemoveConditionRule: (ruleId: string) => void;
}) {
  const selectedField = sourceFieldChoices.find(
    (item) => item.key === rule.fieldKey,
  );
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
      {!rule.isGroup ? (
        <div className="relative flex w-max min-w-full items-center gap-2">
          <div className="flex w-max shrink-0 flex-nowrap items-center gap-2 [&_[data-slot=select-trigger]]:whitespace-nowrap [&_[data-slot=select-value]]:whitespace-nowrap">
            <div className="w-36 shrink-0">
              <SourceFieldSelect
                options={sourceFieldChoices}
                value={rule.fieldKey ?? ""}
                onChange={(value) =>
                  onConditionRuleChange(rule.id, "fieldKey", value)
                }
              />
            </div>
            <Select
              aria-label="条件运算符"
              className="w-max min-w-max"
              selectedKey={operator}
              onSelectionChange={(key) =>
                onConditionRuleChange(rule.id, "operator", String(key ?? "eq"))
              }
            >
              <Select.Trigger>
                <Select.Value>{branchOperatorLabel(operator)}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="rounded-lg">
                <ListBox>
                  {branchOperators.map((item) => (
                    <ListBox.Item
                      key={item.id}
                      id={item.id}
                      textValue={item.label}
                    >
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {hideValue ? (
              <>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">
                  无需值
                </div>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">
                  —
                </div>
              </>
            ) : (
              <>
                <Select
                  aria-label="条件值类型"
                  className="w-max min-w-max"
                  selectedKey={valueType}
                  onSelectionChange={(key) =>
                    onConditionRuleChange(
                      rule.id,
                      "valueType",
                      String(key ?? "value"),
                    )
                  }
                >
                  <Select.Trigger>
                    <Select.Value>
                      {valueType === "field" ? "字段" : "值"}
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover className="rounded-lg">
                    <ListBox>
                      <ListBox.Item id="value" textValue="值">
                        值
                      </ListBox.Item>
                      <ListBox.Item id="field" textValue="字段">
                        字段
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <div className="w-36 shrink-0">
                  {valueType === "field" ? (
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
                      onChange={(value) =>
                        onConditionRuleChange(rule.id, "rawValue", value)
                      }
                    />
                  )}
                </div>
              </>
            )}
            <ButtonGroup
              size="sm"
              className="shrink-0"
              aria-label="条件规则操作"
            >
              <Button
                size="sm"
                isIconOnly
                aria-label="删除条件规则"
                onPress={() => onRemoveConditionRule(rule.id)}
              >
                <TrashIcon />
              </Button>
              <Dropdown>
                <Button size="sm" isIconOnly aria-label="添加条件规则">
                  <AddIcon />
                </Button>
                <Dropdown.Popover className="rounded-lg">
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
            </ButtonGroup>
          </div>
        </div>
      ) : null}

      {childRules.length > 0 ? (
        <div
          className={`relative ml-8 w-max min-w-[568px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-4 pl-8 ${rule.isGroup ? "mt-0" : "mt-5"}`}
        >
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
            <Select.Popover className="rounded-lg">
              <ListBox>
                <ListBox.Item id="and" textValue="且">
                  且
                </ListBox.Item>
                <ListBox.Item id="or" textValue="或">
                  或
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <span className="absolute -left-3 top-1/2 h-px w-3 bg-[var(--color-border)]" />
          <div className="space-y-4">
            {childRules.map((child) => (
              <BranchRuleItem
                key={child.id}
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
  if (
    field?.options?.length &&
    (field.fieldType === "select" || field.fieldType === "radio")
  ) {
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
        onSelectionChange={(key) =>
          onChange(String(key === "none" ? "" : (key ?? "")))
        }
      >
        <Select.Trigger>
          <Select.Value>
            {field.options.find((option) => option.value === value)?.label ??
              "选择匹配值"}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="rounded-lg">
          <ListBox>
            <ListBox.Item id="none" textValue="未配置">
              未配置
            </ListBox.Item>
            {field.options.map((option) => (
              <ListBox.Item
                key={option.value}
                id={option.value}
                textValue={option.label}
              >
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  if (
    field?.fieldType === "multiLineText" ||
    field?.fieldType === "description"
  ) {
    return (
      <textarea
        className="min-h-[84px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
        placeholder={
          operator === "inAny" || operator === "notInAny"
            ? "多个值用逗号分隔"
            : "输入匹配值"
        }
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <Input
      aria-label="匹配值"
      className="h-9 min-h-9"
      placeholder={
        operator === "inAny" || operator === "notInAny"
          ? "多个值用逗号分隔"
          : "输入匹配值"
      }
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
