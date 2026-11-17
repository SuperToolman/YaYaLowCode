import type { BranchRule } from "@/features/form-model/condition-types";
import { compareCondition, decodeConditionValue } from "./compare";
export function evaluateRuleTree(rules: BranchRule[], data: Record<string, unknown>): boolean {
  if (!rules.length) return false;
  function leaf(rule: BranchRule): boolean {
    const actual = data[rule.fieldKey || ""];
    const expected = rule.valueType === "field" ? data[rule.sourceFieldKey || ""] : decodeConditionValue(rule.rawValue);
    return compareCondition(actual, rule.operator || "eq", expected as import("./value").ConditionValue);
  }
  function group(parent?: string, depth = 0): boolean { if (depth > 200) return false; const siblings = rules.filter(r => (r.parentId || undefined) === parent); if (!siblings.length) return true; const matches = siblings.map(r => { const children = rules.filter(child => child.parentId === r.id); if (r.isGroup) return group(r.id, depth + 1); if (!children.length) return leaf(r); return children[0].logicalOperator === "or" ? leaf(r) || group(r.id, depth + 1) : leaf(r) && group(r.id, depth + 1); }); return siblings[0].logicalOperator === "or" ? matches.some(Boolean) : matches.every(Boolean); }
  return group();
}
