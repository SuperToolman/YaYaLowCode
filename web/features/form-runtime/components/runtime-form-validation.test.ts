import { expect, it } from "vitest";
import { validateRuntimeFields } from "./runtime-form-validation";
import { today, getLocalTimeZone } from "@internationalized/date";
import type { RuntimeSchemaField } from "./runtime-form-types";

function field(id: string, type: RuntimeSchemaField["type"], props: RuntimeSchemaField["props"] = { isRequired: true }): RuntimeSchemaField {
  return { id, label: id, type, row: 0, column: 0, props };
}

it("allows today including earlier times and checks both range endpoints", () => {
  const current = today(getLocalTimeZone());
  const fields = [field("date", "date", { dateTodayOrFuture: true }), field("range", "dateRange", { dateTodayOrFuture: true })];
  expect(validateRuntimeFields(fields, { date: `${current}T00:00:00`, range: [current.toString(), current.add({ days: 1 }).toString()] })).toEqual({});
  expect(validateRuntimeFields(fields, { date: current.subtract({ days: 1 }).toString(), range: [current.toString(), current.subtract({ days: 1 }).toString()] })).toEqual({ date: "日期必须是今天及之后", range: "日期必须是今天及之后" });
  expect(validateRuntimeFields(fields, {})).toEqual({});
});

it("validates stored uploads, selections, ranges and rich text instead of hidden native inputs", () => {
  const fields = [field("files", "attachment"), field("choices", "multiSelect"), field("range", "dateRange"), field("body", "richText"), field("region", "countryCity"), field("amount", "number")];
  expect(Object.keys(validateRuntimeFields(fields, { amount: 0, range: ["2026-10-08", ""], body: { type: "doc", content: [{ type: "paragraph" }] } }))).toEqual(["files", "choices", "range", "body", "region"]);
  expect(validateRuntimeFields(fields, {
    files: [{ fileId: "uploaded" }], choices: ["a"], range: ["2026-10-08", "2026-10-09"],
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
    region: { code: "CN" }, amount: 0,
  })).toEqual({});
});

it("skips hidden and non-editable groups and validates each subform row", () => {
  const fields = [field("group", "groupContainer"), { ...field("text", "singleLineText"), parentGroupId: "group" }, field("hidden", "groupContainer", { isHidden: true }), { ...field("ignored", "singleLineText"), parentGroupId: "hidden" }, field("table", "subform", {}), { ...field("cell", "singleLineText"), parentGroupId: "table" }, field("disabled", "singleLineText", { isRequired: true, isDisabled: true })];
  expect(validateRuntimeFields(fields, { table: [{ cell: "" }, { cell: "ok" }] })).toEqual({ text: "请填写text", "table:0:cell": "请填写cell" });
});

it("preserves numeric bounds when disabling browser validation popups", () => {
  const fields = [field("amount", "number", { minValue: 1, maxValue: 5 })];
  expect(validateRuntimeFields(fields, { amount: 0 })).toEqual({ amount: "不能小于 1" });
  expect(validateRuntimeFields(fields, { amount: 6 })).toEqual({ amount: "不能大于 5" });
});

it.each([
  ["email", "a+b@example.com", "a@example"],
  ["phoneCN", "+8613800138000", "+12125551234"],
  ["idCardCN", "11010519491231002X", "123"],
] as const)("checks %s while allowing optional empty values", (formatValidation, valid, invalid) => {
  const fields = [field("text", "singleLineText", { formatValidation })];
  expect(validateRuntimeFields(fields, { text: valid })).toEqual({});
  expect(validateRuntimeFields(fields, { text: "" })).toEqual({});
  expect(validateRuntimeFields(fields, { text: invalid })).toHaveProperty("text");
  expect(validateRuntimeFields([field("text", "singleLineText", { formatValidation, isRequired: true })], {})).toEqual({ text: "请填写text" });
  expect(validateRuntimeFields([field("text", "singleLineText", {})], { text: invalid })).toEqual({});
});

it("applies format rules inside a subform", () => {
  const fields = [field("rows", "subform", {}), { ...field("email", "singleLineText", { formatValidation: "email" }), parentGroupId: "rows" }];
  expect(validateRuntimeFields(fields, { rows: [{ email: "bad" }, { email: "a@example.com" }] })).toEqual({ "rows:0:email": "请输入有效的邮箱地址" });
});
