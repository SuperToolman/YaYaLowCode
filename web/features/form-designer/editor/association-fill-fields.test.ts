import { describe, expect, it } from "vitest";
import { getAssociationMainTableFields } from "./association-fill-fields";

describe("getAssociationMainTableFields", () => {
  it("includes fields nested in group containers and excludes subform fields", () => {
    const fields = [
      { id: "main", type: "singleLineText" },
      { id: "group", type: "groupContainer" },
      { id: "grouped", type: "number", parentGroupId: "group" },
      { id: "nested-group", type: "groupContainer", parentGroupId: "group" },
      { id: "nested", type: "date", parentGroupId: "nested-group" },
      { id: "subform", type: "subform" },
      { id: "subform-group", type: "groupContainer", parentGroupId: "subform" },
      { id: "subform-field", type: "text", parentGroupId: "subform-group" },
      { id: "description", type: "description" },
      { id: "button", type: "button" },
    ];

    expect(getAssociationMainTableFields(fields).map((field) => field.id)).toEqual([
      "main",
      "grouped",
      "nested",
    ]);
  });

  it("excludes malformed parent cycles", () => {
    const fields = [
      { id: "a", type: "text", parentGroupId: "b" },
      { id: "b", type: "groupContainer", parentGroupId: "a" },
      { id: "main", type: "text" },
    ];

    expect(getAssociationMainTableFields(fields).map((field) => field.id)).toEqual([
      "main",
    ]);
  });
});
