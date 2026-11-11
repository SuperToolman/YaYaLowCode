import { expect, it } from "vitest";
import { today } from "@internationalized/date";
import { getDateBounds, getDateValidation, getDateValidationError, type DateValidation } from "./date-validation";

it("defaults to unrestricted and preserves legacy selections", () => {
  expect(getDateValidation({})).toBe("none");
  expect(getDateValidation({ dateTodayOrFuture: true })).toBe("onOrAfterToday");
  expect(getDateValidation({ dateTodayOrFuture: true, dateValidation: "none" })).toBe("none");
});

it.each([
  ["none", [true, true, true]],
  ["beforeToday", [true, false, false]],
  ["onOrBeforeToday", [true, true, false]],
  ["onOrAfterToday", [false, true, true]],
  ["afterToday", [false, false, true]],
] as const)("applies %s to dates, timestamps, and both range endpoints", (rule, accepted) => {
  const current = today("Asia/Shanghai");
  const dates = [current.subtract({ days: 1 }), current, current.add({ days: 1 })];
  const bounds = getDateBounds(rule);
  dates.forEach((date, index) => {
    const allowed = getDateValidationError(rule as DateValidation, [date.toString()]) === undefined;
    expect(allowed).toBe(accepted[index]);
    expect(getDateValidationError(rule, [`${date}T23:59:59`]) === undefined).toBe(accepted[index]);
    expect(getDateValidationError(rule, [date.toString(), date.toString()]) === undefined).toBe(accepted[index]);
    expect(!(bounds.minValue && date.compare(bounds.minValue) < 0) && !(bounds.maxValue && date.compare(bounds.maxValue) > 0)).toBe(accepted[index]);
  });
});
