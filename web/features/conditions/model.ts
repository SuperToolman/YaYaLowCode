import type { BranchRule, BranchRuleOperator } from "@/features/form-model/condition-types";
import { conditionRoot, decodeConditionValue } from "./value";

export const branchOperators: Array<{ id: BranchRuleOperator; label: string }> =
  [
    { id: "eq", label: "等于" },
    { id: "neq", label: "不等于" },
    { id: "inAny", label: "等于任意一个" },
    { id: "notInAny", label: "不等于任意一个" },
    { id: "hasValue", label: "有值" },
    { id: "noValue", label: "无值" },
    { id: "contains", label: "包含" },
    { id: "notContains", label: "不包含" },
    { id: "gt", label: "大于 / 晚于" },
    { id: "gte", label: "大于等于 / 不早于" },
    { id: "lt", label: "小于 / 早于" },
    { id: "lte", label: "小于等于 / 不晚于" },
    { id: "between", label: "区间（含边界）" },
    { id: "containsAny", label: "包含任意一个" },
    { id: "containsAll", label: "包含全部" },
    { id: "containsNone", label: "不包含任意一个" },
  ];

export function createBranchRule(parentId?: string): BranchRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    logicalOperator: "and",
    fieldKey: "",
    operator: "eq",
    rawValue: "",
    valueType: "value",
    sourceFieldKey: "",
  };
}

export function normalizeBranchRule(value: unknown): BranchRule | null {
  if (!value || typeof value !== "object") return null;
  const current = value as Record<string, unknown>;
  const operator = normalizeBranchRuleOperator(current.operator);
  return {
    id:
      typeof current.id === "string" && current.id
        ? current.id
        : `rule-${Date.now()}`,
    parentId:
      typeof current.parentId === "string" && current.parentId
        ? current.parentId
        : undefined,
    logicalOperator: current.logicalOperator === "or" ? "or" : "and",
    isGroup: current.isGroup === true,
    fieldKey: typeof current.fieldKey === "string" ? current.fieldKey : "",
    operator,
    rawValue: typeof current.rawValue === "string" ? current.rawValue : "",
    valueType: current.valueType === "field" ? "field" : "value",
    sourceFieldKey:
      typeof current.sourceFieldKey === "string" ? current.sourceFieldKey : "",
  };
}

export function normalizeBranchRuleOperator(
  value: unknown,
): BranchRuleOperator {
  // Preserve unknown operators so validation can report them instead of changing meaning.
  return (typeof value === "string" && value ? value : "eq") as BranchRuleOperator;
}

export function validateRuleTree(
  rules: BranchRule[],
  fieldIds?: Set<string>,
): string | undefined {
  if (!rules.length || !rules.some((rule) => !rule.isGroup))
    return "按条件过滤至少需要一条有效规则";
  if (rules.length > 200) return "条件最多支持200条";
  const ids = new Set(rules.map((rule) => rule.id));
  if (ids.size !== rules.length) return "筛选规则 ID 重复";
  for (const rule of rules) {
    if (!rule.id || (rule.parentId && !ids.has(rule.parentId)))
      return "筛选规则分组无效";
    const visited = new Set([rule.id]);
    let parent = rule.parentId;
    while (parent) {
      if (visited.has(parent)) return "筛选规则分组不能循环引用";
      visited.add(parent);
      parent = rules.find((item) => item.id === parent)?.parentId;
    }
    if (rule.isGroup) {
      if (!rules.some((item) => item.parentId === rule.id))
        return "筛选条件组不能为空";
      continue;
    }
    if (!rule.fieldKey || !conditionRoot(rule.fieldKey) || (fieldIds && !fieldIds.has(conditionRoot(rule.fieldKey))))
      return "请选择有效的筛选字段";
    if (
      !branchOperators.some((item) => item.id === (rule.operator ?? "eq"))
    )
      return "请选择有效的筛选运算符";
    if (
      !(["hasValue", "noValue"] as string[]).includes(rule.operator ?? "eq") &&
      (rule.valueType === "field" ? !rule.sourceFieldKey || !conditionRoot(rule.sourceFieldKey) || Boolean(fieldIds && !fieldIds.has(conditionRoot(rule.sourceFieldKey))) : !rule.rawValue?.trim() || decodeConditionValue(rule.rawValue) === null)
    )
      return "请填写筛选值";
    if (rule.operator === "between" && rule.valueType !== "field") {
      const value = decodeConditionValue(rule.rawValue);
      if (!Array.isArray(value) || value.length !== 2 || value.some(item => item === "" || item === null) || value[0]! > value[1]!) return "请填写有效的区间上下界";
    }
    if (rule.valueType !== "field" && !["hasValue", "noValue"].includes(rule.operator ?? "eq")) {
      const value = decodeConditionValue(rule.rawValue);
      if (Array.isArray(value) && (!value.length || value.some(item => item === null || typeof item === "string" && !item.trim()))) return "请补全匹配值";
      if (typeof value === "string" && !value.trim() && !["hasValue", "noValue"].includes(rule.operator ?? "eq")) return "请填写筛选值";
    }
  }
}

export function promoteRuleToChildGroup(
  rules: BranchRule[],
  ruleId: string,
): BranchRule[] {
  const index = rules.findIndex((rule) => rule.id === ruleId);
  const target = rules[index];
  if (!target || target.isGroup) return rules;
  const movedRule = {
    ...target,
    id: createBranchRule(target.id).id,
    parentId: target.id,
    logicalOperator: "and" as const,
    isGroup: false,
  };
  const group: BranchRule = {
    id: target.id,
    parentId: target.parentId,
    logicalOperator: target.logicalOperator ?? "and",
    isGroup: true,
  };
  return [
    ...rules.slice(0, index),
    group,
    movedRule,
    createBranchRule(target.id),
    ...rules.slice(index + 1),
  ];
}
