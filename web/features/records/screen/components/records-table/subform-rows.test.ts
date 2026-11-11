import { expect, it } from "vitest";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";
import { getSubformAncestors, getSubformDataRows, getSubformInstanceCount, getSubformTableFields } from "@/features/records/screen/components/records-table/subform-rows";

const field = (id: string, type: RuntimeSchemaField["type"], label: string, parentGroupId?: string): RuntimeSchemaField => ({ id, type, label, parentGroupId, row: 0, column: 0 });
const fields = [field("title", "singleLineText", "标题"), field("a", "subform", "订单明细"), field("group", "groupContainer", "分组", "a"), field("product", "singleLineText", "商品", "group"), field("b", "subform", "联系人"), field("name", "member", "姓名", "b")];

it("子表字段标题带组件名称，跨布局分组解析所属子表", () => {
  expect(getSubformTableFields(fields.filter((f) => f.type !== "groupContainer"), fields).map((f) => f.label)).toEqual(["标题", "订单明细.商品", "联系人.姓名"]);
  expect(getSubformAncestors(fields[3], fields).map((f) => f.id)).toEqual(["a"]);
});

it("多个子表保留各自所有行，不拼接也不产生笛卡尔积", () => {
  const data = { title: "主记录", a: [{ product: "商品1" }, { product: "商品2" }], b: [{ name: "user-id" }] };
  const rows = getSubformDataRows("record", data, fields);
  expect(rows.map((r) => r.label)).toEqual(["订单明细 1", "订单明细 2", "联系人 1"]);
  expect(rows.map((r) => r.data)).toEqual([...data.a, ...data.b]);
  expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  expect(getSubformDataRows("other-record", data, fields)[0].id).not.toBe(rows[0].id);
});

it("没有数据、不显示的子表和异常行不会生成展开行", () => {
  expect(getSubformDataRows("r", { a: [], b: null }, fields)).toEqual([]);
  expect(getSubformDataRows("r", { a: [null, 1, [], { product: "有效" }] }, fields)).toHaveLength(1);
  expect(getSubformDataRows("r", { a: [{ product: "隐藏" }] }, fields)).toHaveLength(1);
});

it("摘要数量只计算有效子表实例", () => {
  expect(getSubformInstanceCount({ a: [{}, null, 1, [], { product: "有效" }] }, "a")).toBe(2);
  expect(getSubformInstanceCount({ a: null }, "a")).toBe(0);
});

it("嵌套子表归属各自父行", () => {
  const nested = [...fields, field("nested", "subform", "批次", "a"), field("batch", "singleLineText", "批号", "nested")];
  const rows = getSubformDataRows("r", { a: [{ product: "p", nested: [{ batch: "001" }, { batch: "002" }] }] }, nested);
  expect(rows).toHaveLength(1);
  expect(rows[0].children.map((r) => r.data.batch)).toEqual(["001", "002"]);
  expect(getSubformTableFields(nested, nested).at(-1)?.label).toBe("订单明细.批次.批号");
});
