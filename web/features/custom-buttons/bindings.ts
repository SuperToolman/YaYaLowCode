import type { BranchRule, SourceFieldChoice } from "@/features/automation-editor/condition-rules";
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
const scalar = (value: unknown): string => value == null ? "" : typeof value === "string" ? value.trim() : typeof value === "object" ? JSON.stringify(value) : String(value);
const hasValue = (value: unknown): boolean => value != null && (typeof value === "string" ? !!value.trim() : Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.keys(value).length > 0 : true);
export function evaluateBinding(button: Pick<ButtonDefinition, "availability">, record: FormRecord): boolean {
  if (button.availability.mode === "all") return true;
  const data: Record<string, unknown> = { instanceId: record.id, instanceTitle: `${record.createdBy || "用户"}发起的记录`, submitter: record.createdBy, submitterOrganization: record.submitterOrganization, createdAt: record.createdAt, updatedAt: record.updatedAt, ...record.data };
  const rules: BranchRule[] = button.availability.rules;
  if (!rules.length) return false;
  function leaf(rule: BranchRule): boolean {
    const actual = data[rule.fieldKey || ""];
    const expected = rule.valueType === "field" ? scalar(data[rule.sourceFieldKey || ""]) : rule.rawValue?.trim() || "";
    switch (rule.operator || "eq") { case "hasValue": return hasValue(actual); case "noValue": return !hasValue(actual); case "neq": return actual == null || scalar(actual) !== expected; case "inAny": return actual != null && expected.split(",").map(s => s.trim()).filter(Boolean).includes(scalar(actual)); case "notInAny": return actual == null || !expected.split(",").map(s => s.trim()).filter(Boolean).includes(scalar(actual)); default: return actual != null && scalar(actual) === expected; }
  }
  function group(parent?: string, depth = 0): boolean { if (depth > 200) return false; const siblings = rules.filter(r => (r.parentId || undefined) === parent); if (!siblings.length) return true; const matches = siblings.map(r => { const children = rules.filter(child => child.parentId === r.id); if (r.isGroup) return group(r.id, depth + 1); if (!children.length) return leaf(r); return children[0].logicalOperator === "or" ? leaf(r) || group(r.id, depth + 1) : leaf(r) && group(r.id, depth + 1); }); return siblings[0].logicalOperator === "or" ? matches.some(Boolean) : matches.every(Boolean); }
  return group();
}
