import { expect, it } from "vitest";
import { buttonPageUrl, buttonPageParams, changeTarget, emptyDraft, validatePageParameters, type ButtonDefinition, type ButtonParameter } from "./model";

const parameters: ButtonParameter[] = [
  { id: "1", name: "customerCode", type: "field", fieldId: "code" },
  { id: "2", name: "fixed", type: "constant", value: "中文 &?=# +" },
  ...["empty", "array", "object", "zero", "bool", "createdAt"].map(id => ({ id, name: id, type: "field" as const, fieldId: id })),
];
it.each(["internal", "external"] as const)("%s links transmit parameters in both modes and opening methods", linkType => {
  for (const pageMode of ["view", "edit"] as const) for (const openMode of ["window", "sidebar"] as const) {
    const button: ButtonDefinition = { ...emptyDraft(), id: "b", appId: "app", formUuid: "source", createdAt: "", updatedAt: "", actionType: "open_page",
      actionConfig: { targetAppId: "app", targetFormUuid: "source", fieldIds: [], linkType, pageMode, openMode, parameters, url: "https://example.com/path?keep=yes&fixed=old#anchor" } };
    const url = buttonPageUrl(button, "source", "record1", { code: "客户/001", empty: null, array: [1, "a"], object: { n: 2 }, zero: 0, bool: false, createdAt: "2026-10-26" });
    const parsed = new URL(url, "http://local");
    expect(parsed.searchParams.get("customerCode")).toBe("客户/001");
    expect(parsed.searchParams.get("fixed")).toBe("中文 &?=# +");
    expect(parsed.searchParams.get("empty")).toBe("");
    expect(parsed.searchParams.get("array")).toBe('[1,"a"]');
    expect(parsed.searchParams.get("object")).toBe('{"n":2}');
    expect(parsed.searchParams.get("zero")).toBe("0");
    expect(parsed.searchParams.get("bool")).toBe("false");
    expect(buttonPageParams(url, "app", "source").customerCode).toBe("客户/001");
    if (linkType === "external") { expect(parsed.hash).toBe("#anchor"); expect(parsed.searchParams.get("keep")).toBe("yes"); }
    else { expect(parsed.searchParams.get("buttonPageMode")).toBe(pageMode); expect(parsed.searchParams.get("record")).toBe("record1"); }
  }
});
it("validates names, duplicates, reserved names and source fields", () => {
  const row: ButtonParameter = { id: "p", name: "code", type: "constant", value: "" };
  const validate = (rows: ButtonParameter[]) => validatePageParameters(rows, [{ id: "code", type: "singleLineText" }], false);
  expect(validate([row])).toBe("");
  expect(validate([{ ...row, name: " " }])).toContain("必填");
  expect(validate([{ ...row, name: "x".repeat(21) }])).toContain("20");
  expect(validate([row, { ...row, id: "other", name: " code " }])).toContain("重复");
  for (const name of ["appId", "formUuid", "buttonPageMode", "record", "task", "viewUuid"]) expect(validate([{ ...row, name }])).toContain("保留");
  expect(validate([{ ...row, type: "field", fieldId: "missing" }])).toContain("有效");
  expect(validate([{ ...row, type: "field", fieldId: "createdAt" }])).toBe("");
  expect(changeTarget({ ...emptyDraft(), actionConfig: { ...emptyDraft().actionConfig, parameters: [row] } }, "app", "form").actionConfig.parameters).toEqual([row]);
});
