import type { BranchRule } from "@/features/form-model/condition-types";
const scalar = (value: unknown): string => value == null ? "" : typeof value === "string" ? value.trim() : typeof value === "object" ? JSON.stringify(value) : String(value);
const hasValue = (value: unknown): boolean => value != null && (typeof value === "string" ? !!value.trim() : Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.keys(value).length > 0 : true);
export function evaluateRuleTree(rules: BranchRule[], data: Record<string, unknown>): boolean {
  if (!rules.length) return false;
  function leaf(rule: BranchRule): boolean {
    const actual = data[rule.fieldKey || ""];
    const expected = rule.valueType === "field" ? scalar(data[rule.sourceFieldKey || ""]) : rule.rawValue?.trim() || "";
    switch (rule.operator || "eq") { case "hasValue": return hasValue(actual); case "noValue": return !hasValue(actual); case "neq": return actual == null || scalar(actual) !== expected; case "inAny": return actual != null && expected.split(",").map(s => s.trim()).filter(Boolean).includes(scalar(actual)); case "notInAny": return actual == null || !expected.split(",").map(s => s.trim()).filter(Boolean).includes(scalar(actual)); default: return actual != null && scalar(actual) === expected; }
  }
  function group(parent?: string, depth = 0): boolean { if (depth > 200) return false; const siblings = rules.filter(r => (r.parentId || undefined) === parent); if (!siblings.length) return true; const matches = siblings.map(r => { const children = rules.filter(child => child.parentId === r.id); if (r.isGroup) return group(r.id, depth + 1); if (!children.length) return leaf(r); return children[0].logicalOperator === "or" ? leaf(r) || group(r.id, depth + 1) : leaf(r) && group(r.id, depth + 1); }); return siblings[0].logicalOperator === "or" ? matches.some(Boolean) : matches.every(Boolean); }
  return group();
}
