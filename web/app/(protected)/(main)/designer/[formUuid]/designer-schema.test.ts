import { describe, expect, it } from "vitest";
import { buildSchema, getDefaultPageDesignerProps, normalizeDesignerFields } from "./designer-schema";
import type { PlacedField } from "./designer-types";

describe("retired field configuration", () => {
  it.each(["simple", "surface", "bordered", "divider"] as const)("preserves the %s group style when saving and reopening", (groupStyle) => {
    const fields: PlacedField[] = [{ id: "group", type: "groupContainer", label: "分组", row: 0, column: 0, rowSpan: 1, colSpan: 1, props: { groupStyle } }];
    const saved = buildSchema("form", "表单", fields, getDefaultPageDesignerProps());
    expect(normalizeDesignerFields(saved.fields)[0].props.groupStyle).toBe(groupStyle);
  });
  it("cleans historical fields on load and save while preserving status and layout", () => {
    const fields: PlacedField[] = [{
      id: "child", type: "multiLineText", label: "内容", row: 0, column: 0,
      rowSpan: 2, colSpan: 1, parentGroupId: "group",
      props: Object.assign({ isDisabled: true, isReadOnly: false, isRequired: true },
        { agentDataAccess: "deny", rows: 9, step: 0.5 }),
    }];
    const loaded = normalizeDesignerFields(fields);
    const saved = buildSchema("form", "表单", fields, getDefaultPageDesignerProps());
    for (const field of [loaded[0], saved.fields[0]]) {
      expect(field.props).not.toHaveProperty("agentDataAccess");
      expect(field.props).not.toHaveProperty("rows");
      expect(field.props).not.toHaveProperty("step");
      expect(field.props).toMatchObject({ isDisabled: true, isReadOnly: false, isRequired: true });
      expect(field.parentGroupId).toBe("group");
      expect(field.rowSpan).toBe(2);
    }
    expect(fields[0].props).toHaveProperty("agentDataAccess", "deny");
  });
});
