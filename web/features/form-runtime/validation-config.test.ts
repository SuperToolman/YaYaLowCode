import { expect, it } from "vitest";
import { normalizeValidationProps, updateValidationProps } from "./validation-config";

it.each([{ isUnique: true }, { formatValidation: "email" }, { minValue: 0 }, { maxValue: 100 }])("preserves optional fields when adding %o", (patch) => {
  expect(updateValidationProps({ isRequired: false }, patch)).toEqual({ ...patch, isRequired: false });
  expect(updateValidationProps({}, patch)).toEqual(patch);
});

it("required-off preserves all extra rules and unrelated settings", () => {
  const current = { isRequired: true, isUnique: true, formatValidation: "phoneCN", minValue: 0, maxValue: 100, placeholder: "value" };
  expect(updateValidationProps(current, { isRequired: false })).toEqual({ ...current, isRequired: false });
  expect(current.isRequired).toBe(true);
});

it("changing individual rules does not affect other rules", () => {
  expect(updateValidationProps({ isRequired: true, isUnique: true }, { isUnique: false })).toEqual({ isRequired: true, isUnique: false });
  expect(updateValidationProps(updateValidationProps({ isRequired: true, formatValidation: "email" }, { isRequired: false }), { isRequired: true })).toEqual({ isRequired: true, formatValidation: "email" });
});

it("preserves historical required settings when loading a schema", () => {
  expect(normalizeValidationProps({ isRequired: false, isUnique: true })).toEqual({ isRequired: false, isUnique: true });
  expect(normalizeValidationProps({ formatValidation: "email" })).toEqual({ formatValidation: "email" });
  expect(normalizeValidationProps({ isRequired: false })).toEqual({ isRequired: false });
});
