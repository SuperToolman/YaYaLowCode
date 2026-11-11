import { expect, it } from "vitest";
import { collectGroupDescendantIds, normalizeRichTextLayouts, planFieldInsertion, resizeField } from "./designer-layout";
import type { PlacedField, ResizeState } from "./designer-types";

const field = (id: string, extra: Partial<PlacedField> = {}): PlacedField => ({ id, type: "singleLineText", label: id,
  row: 0, column: 0, rowSpan: 1, colSpan: 1, props: {}, parentGroupId: null, ...extra });
const resize = (f: PlacedField): ResizeState => ({ fieldId: f.id, direction: "columns", startX: 0, startY: 0, startRowSpan: f.rowSpan, startColSpan: f.colSpan });

it("保持零跨度变化的引用，扩列后稳定推挤碰撞字段且不修改原数组", () => {
  const a = field("a"), b = field("b", { column: 1 }), c = field("c", { row: 1, column: 1 });
  const fields = [a, b, c];
  expect(resizeField(fields, resize(a), 0, 0)).toBe(fields);
  const next = resizeField(fields, resize(a), 0, 1);
  expect(next.map((f) => [f.id, f.row, f.colSpan])).toEqual([["a", 0, 2], ["b", 1, 1], ["c", 2, 1]]);
  expect(fields).toEqual([a, b, c]); expect(b.row).toBe(0);
});
it("插入保留既有字段的顺序和推挤方向", () => {
  const fields = [field("a"), field("b", { row: 1 })];
  const result = planFieldInsertion(fields, { fieldId: null, type: "singleLineText", rowSpan: 1, colSpan: 1 }, "a", "before-row");
  expect(result.valid).toBe(true);
  expect(result.fields.map((f) => [f.id, f.row])).toEqual([["a", 1], ["b", 2]]);
});
it("嵌套后代索引保持容器边界，已归一化富文本复用对象", () => {
  const group = field("group", { type: "groupContainer", colSpan: 3 });
  const inner = field("inner", { type: "groupContainer", parentGroupId: "group" });
  const child = field("child", { parentGroupId: "inner" });
  const rich = field("rich", { type: "richText", parentGroupId: "group", colSpan: 3 });
  const fields = [group, inner, child, rich, field("outside")];
  expect([...collectGroupDescendantIds(fields, "group")].sort()).toEqual(["child", "inner", "rich"]);
  expect(normalizeRichTextLayouts(fields)[3]).toBe(rich);
});
