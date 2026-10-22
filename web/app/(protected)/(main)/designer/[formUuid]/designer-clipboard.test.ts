import { describe, expect, it } from "vitest";
import type { PlacedField } from "./designer-types";
import { normalizeSubformChildLayouts, placePastedFields } from "./designer-clipboard";

function field(id: string, options: Partial<PlacedField> = {}): PlacedField {
  return {
    id,
    type: "singleLineText",
    label: id,
    row: 0,
    column: 0,
    rowSpan: 1,
    colSpan: 1,
    parentGroupId: null,
    props: {},
    ...options,
  };
}

describe("designer clipboard placement", () => {
  it("places a top-level copy in the first free cell, not at the bottom", () => {
    const fields = [field("a"), field("b", { column: 2 })];
    const copied = field("copy", { row: 4, column: 3 });
    expect(placePastedFields(fields, [copied])?.at(-1)).toMatchObject({ row: 0, column: 3 });
  });

  it("wraps to the next row when the current row has no free cell", () => {
    const fields = Array.from({ length: 6 }, (_, column) => field(`a${column}`, { column }));
    expect(placePastedFields(fields, [field("copy", { column: 5 })])?.at(-1))
      .toMatchObject({ row: 1, column: 5 });
  });

  it("keeps a copied child in its existing group container", () => {
    const group = field("group", { type: "groupContainer", colSpan: 2, rowSpan: 2 });
    const child = field("child", { column: 0, parentGroupId: group.id });
    expect(placePastedFields([group, child], [field("copy", { parentGroupId: group.id })])?.at(-1))
      .toMatchObject({ row: 0, column: 1, parentGroupId: "group" });
  });

  it("wraps subform children within six columns and repairs legacy overflow", () => {
    const subform = field("subform", { type: "subform", colSpan: 6 });
    const children = Array.from({ length: 6 }, (_, column) => field(`child${column}`, {
      column,
      parentGroupId: subform.id,
    }));
    const pasted = placePastedFields([subform, ...children], [field("copy", { parentGroupId: subform.id })]);
    expect(pasted?.at(-1)).toMatchObject({ row: 1, column: 0, parentGroupId: "subform" });

    const repaired = normalizeSubformChildLayouts([
      subform,
      field("overflow", { row: 12, column: 7, parentGroupId: subform.id }),
    ]);
    expect(repaired[1]).toMatchObject({ row: 0, column: 0, rowSpan: 1, colSpan: 1 });
  });
});
