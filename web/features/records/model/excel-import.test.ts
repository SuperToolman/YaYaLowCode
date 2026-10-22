import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  assembleImportRecords,
  buildImportTemplate,
  getExcelImportFields,
  parseImportWorksheet,
} from "./excel-import";
import type { RuntimeSchemaField } from "@features/form-runtime/components";

const field = (
  id: string,
  label: string,
  type: RuntimeSchemaField["type"] = "singleLineText",
  parentGroupId?: string,
): RuntimeSchemaField => ({
  id,
  label,
  type,
  parentGroupId,
  row: 0,
  column: 0,
});
const schema = [
  field("code", "代码"),
  field("banks", "银行账户", "subform"),
  field("account", "银行账号", "singleLineText", "banks"),
  field("swift", "SWIFT 代码", "singleLineText", "banks"),
];
const fields = getExcelImportFields(schema);
const columns = fields.map((f) => ({
  id: f.id,
  label: f.label,
  header: f.label,
}));
const convert = (_field: unknown, value: unknown) =>
  String(value ?? "").trim() || undefined;

describe("宜搭 Excel import", () => {
  it.each([true, false])(
    "groups merged main rows, including repeated hidden values: %s",
    (repeat) => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ["代码", "银行账户", "银行账户"],
        ["代码", "银行账号", "SWIFT 代码"],
        ["A", "44250100008500002040", "SWIFT1"],
        [repeat ? "A" : "", "000123", "SWIFT2"],
        ["A", "another", "SWIFT3"],
      ]);
      sheet["!merges"] = [
        XLSX.utils.decode_range("A1:A2"),
        XLSX.utils.decode_range("B1:C1"),
        XLSX.utils.decode_range("A3:A4"),
      ];
      const parsed = parseImportWorksheet(sheet, columns);
      expect(parsed.headers).toEqual([
        "代码",
        "银行账户 / 银行账号",
        "银行账户 / SWIFT 代码",
      ]);
      expect(parsed.rows).toHaveLength(3);
      const records = assembleImportRecords(
        parsed.rows,
        parsed.mappings,
        fields,
        parsed.rowGroups,
        convert,
      );
      expect(records.map((r) => r.data)).toEqual([
        {
          code: "A",
          banks: [
            { account: "44250100008500002040", swift: "SWIFT1" },
            { account: "000123", swift: "SWIFT2" },
          ],
        },
        { code: "A", banks: [{ account: "another", swift: "SWIFT3" }] },
      ]);
    },
  );
  it("keeps plain single headers and does not group duplicate values", () => {
    const parsed = parseImportWorksheet(
      XLSX.utils.aoa_to_sheet([["代码"], ["A"], ["A"]]),
      columns,
    );
    expect(parsed.rows).toHaveLength(2);
    expect(
      assembleImportRecords(
        parsed.rows,
        parsed.mappings,
        fields,
        parsed.rowGroups,
        convert,
      ),
    ).toHaveLength(2);
  });
  it("round trips two-level template headers and ignores an empty child row", () => {
    const template = buildImportTemplate(fields, [{ label: "提交人" }]);
    const sheet = XLSX.utils.aoa_to_sheet([
      ...template.matrix,
      ["A", "", "", "someone"],
    ]);
    sheet["!merges"] = template.merges;
    const parsed = parseImportWorksheet(sheet, columns);
    expect(parsed.mappings).toEqual({
      0: "code",
      1: "account",
      2: "swift",
      3: "",
    });
    expect(
      assembleImportRecords(
        parsed.rows,
        parsed.mappings,
        fields,
        parsed.rowGroups,
        convert,
      )[0].data,
    ).toEqual({ code: "A" });
  });
  it("rejects duplicate targets and mixing whole-subform with child mappings", () => {
    expect(() =>
      assembleImportRecords(
        [[1, 2]],
        { 0: "account", 1: "account" },
        fields,
        undefined,
        convert,
      ),
    ).toThrow("同一字段");
    expect(() =>
      assembleImportRecords(
        [[1, 2]],
        { 0: "banks", 1: "account" },
        fields,
        undefined,
        convert,
      ),
    ).toThrow("同时导入");
  });
  it("does not offer hidden or read-only subform children", () => {
    expect(
      getExcelImportFields(
        schema.map((f) =>
          f.id === "banks" ? { ...f, props: { isReadOnly: true } } : f,
        ),
      ).map((f) => f.id),
    ).toEqual(["code"]);
  });
});
