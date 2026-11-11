import { describe, expect, it } from "vitest";
import { placeToolboxField } from "./designer-toolbox";
import type { PlacedField } from "./designer-types";

function field(id: string, options: Partial<PlacedField> = {}): PlacedField {
  return { id, type: "singleLineText", label: id, row: 0, column: 0, rowSpan: 1, colSpan: 1, props: {}, parentGroupId: null, ...options };
}

describe("toolbox insertion target", () => {
  it("finds a free position inside the active group using canvas coordinates", () => {
    const group = field("group", { type: "groupContainer", row: 3, column: 2, colSpan: 2, rowSpan: 2 });
    const existing = field("existing", { row: 3, column: 2, parentGroupId: group.id });
    const result = placeToolboxField([group, existing], field("new"), group.id);
    expect(result.fields?.at(-1)).toMatchObject({ row: 3, column: 3, parentGroupId: group.id });
  });

  it("keeps full-width components within the active group", () => {
    const group = field("group", { type: "groupContainer", column: 2, colSpan: 2, rowSpan: 2 });
    for (const type of ["richText", "subform"] as const) {
      expect(placeToolboxField([group], field("new", { type, colSpan: 6 }), group.id).fields?.at(-1))
        .toMatchObject({ column: 2, colSpan: 2, parentGroupId: group.id });
    }
  });

  it("uses local columns and single cells for subform children", () => {
    const subform = field("table", { type: "subform", row: 3, colSpan: 6 });
    const existing = field("existing", { row: 3, parentGroupId: subform.id });
    expect(placeToolboxField([subform, existing], field("new", { type: "multiLineText", rowSpan: 2 }), subform.id).fields?.at(-1))
      .toMatchObject({ row: 3, column: 1, rowSpan: 1, colSpan: 1, parentGroupId: subform.id });
  });

  it("rejects containers and rich text inside subforms", () => {
    const subform = field("table", { type: "subform", colSpan: 6 });
    for (const type of ["groupContainer", "subform", "richText"] as const) {
      const result = placeToolboxField([subform], field("new", { type }), subform.id);
      expect(result.error).toBeDefined();
      expect(result.fields).toBeUndefined();
    }
  });

  it("inserts into the canvas when a regular component or nothing is active", () => {
    const existing = field("existing");
    for (const activeId of [existing.id, null, "missing"]) {
      expect(placeToolboxField([existing], field("new"), activeId).fields?.at(-1))
        .toMatchObject({ row: 0, column: 1, parentGroupId: null });
    }
  });

  it("enforces serial number uniqueness separately for each subform and the canvas", () => {
    const table = field("table", { type: "subform", colSpan: 6 });
    const group = field("group", { type: "groupContainer", row: 2, colSpan: 2, rowSpan: 2 });
    const canvasSerial = field("serial", { type: "serialNumber", row: 2, parentGroupId: group.id });
    const fields = [table, group, canvasSerial];
    const incoming = field("new", { type: "serialNumber" });
    expect(placeToolboxField(fields, incoming, group.id).error).toBeDefined();
    expect(placeToolboxField(fields, incoming, null).error).toBeDefined();
    const result = placeToolboxField(fields, incoming, table.id);
    expect(result.fields?.at(-1)).toMatchObject({ parentGroupId: table.id });
    expect(placeToolboxField(result.fields!, field("another", { type: "serialNumber" }), table.id).error).toBeDefined();
  });
});
