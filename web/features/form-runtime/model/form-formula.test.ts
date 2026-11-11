import { expect, it } from "vitest";
import { calculateFormulaValues } from "./form-formula";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";

function formula(id: string, expression: string): RuntimeSchemaField {
  return { id, type: "number", label: id, row: 0, column: 0, props: { defaultValueType: "formula", defaultValueFormula: expression } };
}
it("逆序的 100 层依赖与分支得到正确结果", () => {
  const fields = Array.from({ length: 100 }, (_, index) => formula(`f${index}`, index ? `$f${index - 1}+1` : "$source+1")).reverse();
  fields.push({ id: "source", type: "number", label: "源", row: 0, column: 0 });
  fields.push(formula("branch", "$f50*2"));
  const result = calculateFormulaValues(fields, { source: 2 });
  expect(result.values.f99).toBe(102); expect(result.values.branch).toBe(106);
  expect(result.errors).toEqual({});
});
it("增量计算覆盖多个变更源，保留无关公式值和错误", () => {
  const fields = [formula("a", "$x+1"), formula("b", "$y+1"), formula("sum", "$a+$b"), formula("unrelated", "$missing")];
  fields.push(...["x", "y"].map((id) => ({ id, type: "number" as const, label: id, row: 0, column: 0 })));
  const result = calculateFormulaValues(fields, { x: 5, y: 7, unrelated: "keep" }, {
    changedFieldIds: ["x", "y"], previousErrors: { unrelated: "历史错误" },
  });
  expect(result.values).toMatchObject({ a: 6, b: 8, sum: 14, unrelated: "keep" });
  expect(result.errors.unrelated).toBe("历史错误");
});
it("循环引用、非法引用与 Schema 更新失效", () => {
  const fields = [formula("a", "$b+1"), formula("b", "$a+1"), formula("bad", "$missing+1")];
  const result = calculateFormulaValues(fields, {});
  expect(result.errors.a).toContain("循环引用"); expect(result.errors.b).toContain("循环引用");
  expect(result.errors.bad).toContain("未找到组件引用");
  expect(calculateFormulaValues([formula("a", "2+3")], {}).values.a).toBe(5);
  expect(calculateFormulaValues([formula("a", "2+4")], {}).values.a).toBe(6);
});
