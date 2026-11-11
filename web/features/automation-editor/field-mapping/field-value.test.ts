import { describe, expect, it } from "vitest";
import { decodeMappedFieldValue, encodeMappedFieldValue } from "./field-value";

describe("mapped field values", () => {
  it("round-trips country and region values as structured data", () => {
    const value = { code: "CN-11", name: "北京", path: [] };

    expect(decodeMappedFieldValue("countryCity", encodeMappedFieldValue(value))).toEqual(value);
  });

  it("round-trips array-valued controls", () => {
    const value = ["a", "b"];

    expect(decodeMappedFieldValue("multiSelect", encodeMappedFieldValue(value))).toEqual(value);
  });

  it("keeps scalar values as plain strings", () => {
    expect(encodeMappedFieldValue(42)).toBe("42");
    expect(decodeMappedFieldValue("singleLineText", "hello")).toBe("hello");
  });

  it("uses an empty value for absent structured data and tolerates invalid legacy data", () => {
    expect(encodeMappedFieldValue(null)).toBe("");
    expect(decodeMappedFieldValue("countryCity", "")).toBeUndefined();
    expect(decodeMappedFieldValue("countryCity", "[object Object]")).toBeUndefined();
    expect(decodeMappedFieldValue("checkbox", "invalid")).toEqual([]);
  });
});
