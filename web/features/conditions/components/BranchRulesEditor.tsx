"use client";

import { Button, ButtonGroup, Dropdown, ListBox, Select } from "@heroui/react";
import { Plus as AddIcon, TrashBin as TrashIcon } from "@gravity-ui/icons";
const branchOperatorLabel = (operator: BranchRuleOperator) => branchOperators.find((item) => item.id === operator)?.label ?? "等于";
import { branchOperators, type BranchRule, type BranchRuleOperator } from "@/features/conditions";
import type { SourceFieldChoice } from "@/features/conditions";
import { ConditionFieldSelect, useConditionField } from "./ConditionFieldSelect";
import { ConditionValueEditor } from "./ConditionValueEditor";
import { compatibleFields, operatorIds } from "../value";
const SourceFieldSelect = ConditionFieldSelect;

export function BranchRulesEditor({
  rules,
  sourceFieldChoices,
  comparisonFieldChoices,
  targetFieldLabel,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  comparisonFieldChoices?: SourceFieldChoice[];
  targetFieldLabel?: string;
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
                    comparisonFieldChoices={comparisonFieldChoices}
                    targetFieldLabel={targetFieldLabel}
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
  comparisonFieldChoices,
  targetFieldLabel,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  rule: BranchRule;
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  comparisonFieldChoices?: SourceFieldChoice[];
  targetFieldLabel?: string;
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
  const selectedField = useConditionField(sourceFieldChoices, rule.fieldKey ?? "");
  const comparisonField = useConditionField(comparisonFieldChoices ?? sourceFieldChoices, rule.valueType === "field" ? rule.sourceFieldKey ?? "" : "");
  const allowedOperators = operatorIds(selectedField);
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
                ariaLabel={targetFieldLabel}
                value={rule.fieldKey ?? ""}
                onChange={(value, field) =>
                  { onConditionRuleChange(rule.id, "fieldKey", value); onConditionRuleChange(rule.id, "operator", operatorIds(field)[0]); onConditionRuleChange(rule.id, "rawValue", ""); onConditionRuleChange(rule.id, "sourceFieldKey", ""); }
                }
              />
            </div>
            <Select
              aria-label="条件运算符"
              className="w-max min-w-max"
              selectedKey={operator}
              onSelectionChange={(key) => {
                onConditionRuleChange(rule.id, "operator", String(key ?? "eq"));
                onConditionRuleChange(rule.id, "rawValue", "");
                if (["between", "inAny", "notInAny"].includes(String(key))) onConditionRuleChange(rule.id, "valueType", "value");
              }}
            >
              <Select.Trigger>
                <Select.Value>{branchOperatorLabel(operator)}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="rounded-lg">
                <ListBox>
                  {branchOperators.filter(item => allowedOperators.includes(item.id) || item.id === operator).map((item) => (
                    <ListBox.Item
                      key={item.id}
                      id={item.id}
                      isDisabled={!allowedOperators.includes(item.id)}
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
                      <ListBox.Item id="field" textValue="字段" isDisabled={["between", "inAny", "notInAny"].includes(operator)}>
                        字段
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <div className="w-36 shrink-0">
                  {valueType === "field" ? (
                    <SourceFieldSelect
                      options={comparisonFieldChoices ?? sourceFieldChoices}
                      compatible={field => compatibleFields(selectedField, field)}
                      value={rule.sourceFieldKey ?? ""}
                      onChange={(value) =>
                        onConditionRuleChange(rule.id, "sourceFieldKey", value)
                      }
                    />
                  ) : (
                    <ConditionValueEditor
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

      {!rule.isGroup && selectedField && !allowedOperators.includes(operator) ? <p role="alert" className="text-xs text-danger">当前运算符不适用于此字段，请重新选择。</p> : null}
      {!rule.isGroup && !hideValue && valueType === "field" && comparisonField && !compatibleFields(selectedField, comparisonField) ? <p role="alert" className="text-xs text-danger">比较字段类型或关联目标不一致，请选择兼容字段。</p> : null}
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
                    comparisonFieldChoices={comparisonFieldChoices}
                    targetFieldLabel={targetFieldLabel}
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
