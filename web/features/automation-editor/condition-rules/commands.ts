import type { BranchRule } from "./types";
import { createBranchRule, promoteRuleToChildGroup } from "./model";

export function addRule(rules: BranchRule[], parentId?: string, siblingOfId?: string, count = 1): BranchRule[] {
  if (count === 0 && parentId) return promoteRuleToChildGroup(rules, parentId);
  const next = Array.from({ length: count }, () => createBranchRule(parentId));
  if (!siblingOfId) return [...rules, ...next];
  const index = rules.findIndex((rule) => rule.id === siblingOfId);
  if (index < 0) return [...rules, ...next];
  return [...rules.slice(0, index + 1), ...next, ...rules.slice(index + 1)];
}

export function removeRuleTree(rules: BranchRule[], ruleId: string): BranchRule[] {
  const removed = new Set([ruleId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) if (rule.parentId && removed.has(rule.parentId) && !removed.has(rule.id)) { removed.add(rule.id); changed = true; }
  }
  return rules.filter((rule) => !removed.has(rule.id));
}

export function updateRule(rules: BranchRule[], ruleId: string, key: keyof BranchRule, value: string): BranchRule[] {
  const changed = rules.find((rule) => rule.id === ruleId);
  return rules.map((rule) => {
    if (key === "logicalOperator" && rule.parentId === changed?.parentId) return { ...rule, logicalOperator: value as "and" | "or" };
    if (rule.id !== ruleId) return rule;
    const next = { ...rule, [key]: value } as BranchRule;
    if (key === "fieldKey" || key === "valueType") { next.rawValue = ""; next.sourceFieldKey = ""; }
    if (key === "operator" && (value === "hasValue" || value === "noValue")) next.rawValue = "";
    return next;
  });
}
