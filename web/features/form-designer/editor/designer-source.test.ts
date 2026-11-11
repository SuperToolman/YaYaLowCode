import { describe, expect, it } from "vitest";
import { buildSchema, getDefaultPageDesignerProps } from "./designer-schema";
import { decodeStoredDesignerSchema, parseDesignerSource } from "./designer-source";
import { normalizeSubformChildLayouts } from "./designer-clipboard";

const schema = buildSchema("form", "测试", [{
  id: "a", type: "singleLineText", label: "字段", row: 0, column: 0, rowSpan: 1, colSpan: 1, props: {},
}], getDefaultPageDesignerProps());

describe("designer source edits", () => {
  it("allows deleting fields and preserves page settings", () => {
    expect(parseDesignerSource(JSON.stringify({ ...schema, fields: [] }), "form"))
      .toMatchObject({ fields: [], pageProps: schema.pageProps });
  });
  it.each([
    { fields: [{ ...schema.fields[0], column: 7 }] },
    { fields: [{ ...schema.fields[0], parentGroupId: "missing" }] },
    { fields: [schema.fields[0], schema.fields[0]] },
    { fields: [{ ...schema.fields[0], type: "invalid" }] },
    { formUuid: "other" },
    { pageProps: { dataSources: {} } },
  ])("rejects malformed schema %j", (change) => {
    expect(() => parseDesignerSource(JSON.stringify({ ...schema, ...change }), "form")).toThrow();
  });
  it("rejects invalid JSON", () => expect(() => parseDesignerSource("{", "form")).toThrow());
});

describe("stored designer schema compatibility", () => {
  it("keeps legacy fields and the form definition name when layout metadata is absent", () => {
    const decoded = decodeStoredDesignerSchema({
      fields: [{ fieldId: "legacy-name", fieldName: "旧字段", type: "singleLineText" }],
    }, "form", "正式表单名");
    expect(decoded.formName).toBe("正式表单名");
    expect(decoded.fields).toHaveLength(1);
    expect(decoded.fields[0]).toMatchObject({
      id: "legacy-name", label: "旧字段", row: 0, column: 0, rowSpan: 1, colSpan: 1,
    });
    expect(decoded.fields[0].props).toBeDefined();
  });

  it("loads stored schemas through compatibility normalization while source saves stay strict", () => {
    const stored = { ...schema, formName: "已保存", fields: [{ ...schema.fields[0], column: 7 }] };
    expect(decodeStoredDesignerSchema(stored, "form").fields).toHaveLength(1);
    expect(() => parseDesignerSource(JSON.stringify(stored), "form")).toThrow();
  });

  it("loads historical subform children whose saved columns exceed the six-column grid", () => {
    const parentId = "subform";
    const decoded = decodeStoredDesignerSchema({
      formName: "银行信息",
      fields: [
        { id: parentId, type: "subform", label: "账户列表", row: 0, column: 0, rowSpan: 1, colSpan: 6, props: {} },
        ...[0, 6, 8].map((column, index) => ({
          id: `child-${index}`, type: "singleLineText", label: `字段${index}`,
          row: 0, column, rowSpan: 1, colSpan: 1, parentGroupId: parentId, props: {},
        })),
      ],
    }, "form");
    const children = normalizeSubformChildLayouts(decoded.fields).filter((field) => field.parentGroupId === parentId);
    expect(children.map((field) => field.column)).toEqual([0, 1, 2]);
  });
});
