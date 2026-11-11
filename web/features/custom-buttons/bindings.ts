import { evaluateRuleTree } from "@/features/conditions/evaluate";
import type { SourceFieldChoice } from "@/features/conditions";
import type { FormRecord } from "@/features/records/types";
import type { ButtonDefinition } from "./model";

export type ButtonBinding = { buttonId: string };
export function newBinding(buttonId: string): ButtonBinding { return { buttonId }; }
export function validateButtonConditions(availability: ButtonDefinition["availability"], fields: SourceFieldChoice[]): string {
  if (availability.mode === "all") return "";
  const rules = availability.rules;
  const keys = new Set(fields.map(f => f.key));
  const ids = new Set(rules.map(r => r.id));
  if (!rules.length || rules.length > 200 || ids.size !== rules.length || ids.has("")) return "请配置完整的筛选条件";
  for (const rule of rules) {
    const seen = new Set([rule.id]); let parent = rule.parentId;
    while (parent) { if (!ids.has(parent) || seen.has(parent)) return "条件组结构无效"; seen.add(parent); parent = rules.find(r => r.id === parent)?.parentId; }
    if (rule.isGroup) { if (!rules.some(r => r.parentId === rule.id)) return "条件组不能为空"; continue; }
    if (!keys.has(rule.fieldKey || "")) return "条件字段已失效，请重新选择";
    if (rule.operator === "hasValue" || rule.operator === "noValue") continue;
    if (rule.valueType === "field") { if (!keys.has(rule.sourceFieldKey || "")) return "比较字段已失效，请重新选择"; }
    else if (!rule.rawValue?.trim()) return "请填写条件比较值";
  }
  return "";
}
export function evaluateBinding(button: Pick<ButtonDefinition, "availability">, record: FormRecord): boolean {
  if (button.availability.mode === "all") return true;
  return evaluateRuleTree(button.availability.rules, { instanceId: record.id, instanceTitle: `${record.createdBy || "用户"}发起的记录`, submitter: record.createdBy, submitterOrganization: record.submitterOrganization, createdAt: record.createdAt, updatedAt: record.updatedAt, ...record.data });
}

export function validateAssociationRules(rules: import("@/features/conditions").BranchRule[], targets: SourceFieldChoice[], sources: SourceFieldChoice[]): string {
  const targetKeys = new Set(targets.map(field => field.key));
  const sourceKeys = new Set(sources.map(field => field.key));
  for (const rule of rules.filter(rule => !rule.isGroup)) {
    if (!targetKeys.has(rule.fieldKey || "")) return "关联条件目标字段已失效";
    if (rule.valueType === "field" && !["hasValue", "noValue"].includes(rule.operator || "eq") && !sourceKeys.has(rule.sourceFieldKey || "")) return "关联条件来源字段已失效";
  }
  return validateButtonConditions({ mode: "conditions", rules: rules.map(rule => rule.valueType === "field" ? { ...rule, valueType: "value", rawValue: "source" } : rule) }, targets);
}
