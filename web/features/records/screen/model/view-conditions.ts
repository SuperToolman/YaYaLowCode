import type { ViewConfig } from "./use-form-views";
import type { BranchRule, BranchRuleOperator } from "@/features/conditions";
export function viewConditionRules(config: ViewConfig): BranchRule[] {
  if (config.conditionRules) return config.conditionRules;
  return config.filters.map(rule => ({ id: rule.id, fieldKey: rule.fieldId, operator: ({ contains: "contains", equals: "eq", notEquals: "neq", greaterThan: "gt", lessThan: "lt" } as Record<string, BranchRuleOperator>)[rule.operator], rawValue: rule.value, logicalOperator: "and", valueType: "value" }));
}
