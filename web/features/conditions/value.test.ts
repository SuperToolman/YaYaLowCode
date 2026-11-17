import { expect, it } from "vitest";
import { compareCondition } from "./compare";
import { validateRuleTree } from "./model";
import { compatibleFields, decodeConditionValue, encodeConditionValue, operatorIds, readConditionPath, writeConditionPath } from "./value";

it("数字比较兼容旧字符串值并保留零、布尔值和日期时区语义", () => {
  expect(compareCondition(10, "gt", "2")).toBe(true);
  expect(compareCondition(0, "eq", 0)).toBe(true);
  expect(compareCondition(false, "hasValue", null)).toBe(true);
  expect(compareCondition("2026-11-16T08:00:00+08:00", "eq", "2026-11-16T00:00:00Z")).toBe(true);
  expect(compareCondition(null, "notContains", "小明")).toBe(true);
  expect(compareCondition(["a", "b"], "containsAll", ["b", "a"])).toBe(true);
});

it("数字、选项、附件根据类型限制运算符且关联比较要求同一目标表单", () => {
  const field = (fieldType: string) => ({ key: "field", label: "字段", fieldType, options: [] });
  expect(operatorIds(field("number"))).toContain("between");
  expect(operatorIds(field("number"))).not.toContain("contains");
  expect(operatorIds(field("multiSelect"))).toContain("containsAll");
  expect(operatorIds(field("attachment"))).toEqual(["hasValue", "noValue"]);
  expect(compatibleFields({ ...field("associationFormField"), props: { associationFormId: "A" } }, { ...field("associationFormField"), props: { associationFormId: "B" } })).toBe(false);
});

it("多层路径可往返并拒绝损坏、过深路径与嵌套值", () => {
  const path = { root: "trigger-1:company", path: ["group", "contact"] };
  expect(readConditionPath(writeConditionPath(path))).toEqual(path);
  expect(readConditionPath('__condition_path_v2__:broken').root).toBe("");
  expect(readConditionPath(writeConditionPath({ root: "company", path: Array(9).fill("company") })).root).toBe("");
  expect(decodeConditionValue('__condition_value_v2__:{"unexpected":1}')).toBe(null);
});

it("校验完整的类型化值、空数组和区间，保留旧配置", () => {
  const rule = { id: "r", fieldKey: "amount", operator: "eq" as const, rawValue: "2" };
  expect(validateRuleTree([rule])).toBeUndefined();
  expect(validateRuleTree([{ ...rule, rawValue: encodeConditionValue(0) }])).toBeUndefined();
  expect(validateRuleTree([{ ...rule, rawValue: encodeConditionValue([]) }])).toBeTruthy();
  expect(validateRuleTree([{ ...rule, operator: "between", rawValue: encodeConditionValue([10, 2]) }])).toBeTruthy();
  expect(validateRuleTree([{ ...rule, operator: "between", rawValue: encodeConditionValue([2, 10]) }])).toBeUndefined();
});
