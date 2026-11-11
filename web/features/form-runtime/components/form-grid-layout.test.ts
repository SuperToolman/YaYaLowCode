import { describe, expect, it } from "vitest";
import { getFormGridTemplateRows } from "./form-grid-layout";

describe("getFormGridTemplateRows", () => {
  it("compacts standalone horizontal separator rows without changing field rows", () => {
    expect(getFormGridTemplateRows([
      { type: "singleLineText", row: 0 },
      { type: "separator", row: 1 },
      { type: "number", row: 2 },
    ])).toBe("minmax(68px, auto) minmax(24px, auto) minmax(68px, auto)");
  });

  it("keeps a full height when another field spans the separator row", () => {
    expect(getFormGridTemplateRows([
      { type: "multiLineText", row: 0, rowSpan: 2 },
      { type: "separator", row: 1 },
    ])).toBe("minmax(68px, auto) minmax(68px, auto)");
  });

  it("preserves row offsets, multi-row resizing and empty designer cells", () => {
    expect(getFormGridTemplateRows([
      { type: "separator", row: 5, rowSpan: 2 },
    ], 5, 3)).toBe("minmax(24px, auto) minmax(24px, auto) minmax(68px, auto)");
  });

  it("preserves existing grids without horizontal separators", () => {
    expect(getFormGridTemplateRows([])).toBeUndefined();
    expect(getFormGridTemplateRows([
      { type: "separator", row: 0, props: { orientation: "vertical" } },
    ])).toBeUndefined();
  });
});
