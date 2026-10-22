import { describe, expect, it } from "vitest";
import { buildSchema, getDefaultPageDesignerProps } from "./designer-schema";
import { parseDesignerSource } from "./designer-source";

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
