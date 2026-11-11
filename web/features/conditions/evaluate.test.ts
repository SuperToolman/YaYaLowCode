import { describe, expect, it } from "vitest";
import { evaluateRuleTree } from "./evaluate";
import { validateRuleTree } from "./model";
import type { BranchRule } from "@/features/form-model/condition-types";

describe("共享字段规则求值", () => {
  it("支持分组或关系、字段比较和空值", () => {
    const rules: BranchRule[] = [
      { id: "group", isGroup: true },
      { id: "a", parentId: "group", logicalOperator: "or", fieldKey: "status", operator: "eq", rawValue: "open" },
      { id: "b", parentId: "group", logicalOperator: "or", fieldKey: "name", operator: "eq", valueType: "field", sourceFieldKey: "expected" },
      { id: "c", fieldKey: "empty", operator: "noValue" },
    ];
    expect(validateRuleTree(rules, new Set(["status", "name", "expected", "empty"]))).toBeUndefined();
    expect(evaluateRuleTree(rules, { status: "closed", name: "yes", expected: "yes", empty: [] })).toBe(true);
    expect(evaluateRuleTree(rules, { status: "closed", name: "no", expected: "yes" })).toBe(false);
    expect(evaluateRuleTree(rules, { status: "open", empty: "filled" })).toBe(false);
  });
  it("空条件不匹配任何记录", () => expect(evaluateRuleTree([], {})).toBe(false));
});
