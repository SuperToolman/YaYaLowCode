import { describe, expect, it } from "vitest";
import { mergePageSelection, retainAvailableSelection } from "./selection";

describe("page selection", () => {
  it("selects and clears one row without changing other pages", () => {
    const original = new Set(["other-page"]);
    const selected = mergePageSelection(original, ["first", "second"], new Set(["first"]));
    expect([...selected]).toEqual(["other-page", "first"]);
    expect([...mergePageSelection(selected, ["first", "second"], new Set())]).toEqual(["other-page"]);
    expect([...original]).toEqual(["other-page"]);
  });

  it("selects and clears the current page in one update", () => {
    const original = new Set(["other-page"]);
    const all = mergePageSelection(original, ["first", "second"], new Set(["first", "second"]));
    expect([...all]).toEqual(["other-page", "first", "second"]);
    expect([...mergePageSelection(all, ["first", "second"], new Set())]).toEqual(["other-page"]);
  });

  it("keeps the same state reference for duplicate selection events", () => {
    const current = new Set(["first", "other-page"]);
    expect(mergePageSelection(current, ["first", "second"], new Set(["first"]))).toBe(current);
    expect(mergePageSelection(current, [], new Set())).toBe(current);
  });

  it("clears rows from the prior page when displayed records change", () => {
    const current = new Set(["first", "second"]);
    expect([...retainAvailableSelection(current, new Set(["second", "third"]))]).toEqual(["second"]);
    expect(retainAvailableSelection(current, new Set(["first", "second"]))).toBe(current);
  });
});
