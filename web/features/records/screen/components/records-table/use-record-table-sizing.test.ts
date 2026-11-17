import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { changedColumnWidths, getRecordColumnLayout, safeColumnWidth, useRecordTableSizing } from "./use-record-table-sizing";
import type { RecordDataColumn } from "./record-table-types";

afterEach(cleanup);
const column = (id: string, size: number, pin?: "left" | "right"): RecordDataColumn => ({ id, header: id, cell: () => null, size, minSize: Math.min(size, 80), pin });

it.each([undefined, NaN, Infinity, -Infinity, 0, -1])("rejects invalid widths: %s", (width) => {
  expect(safeColumnWidth(width, 80)).toBe(80);
  const layout = getRecordColumnLayout([{ ...column("name", NaN), minSize: NaN }], { name: width as number });
  expect(layout.columns[0].width).toBe(150);
  expect(layout.columns[0].minWidth).toBe(80);
});

it("orders both frozen edges and recalculates offsets from current widths", () => {
  const columns = [column("body", 200), column("selection", 44, "left"), column("name", 150, "left"), column("actions", 180, "right"), column("more", 80, "right")];
  const layout = getRecordColumnLayout(columns, { name: 240 });
  expect(layout.columns.map((c) => c.id)).toEqual(["selection", "name", "body", "actions", "more"]);
  expect(layout.columns.map((c) => c.style)).toEqual([{ left: 0 }, { left: 44 }, {}, { right: 80 }, { right: 0 }]);
  expect(layout.width).toBe(744);
});

it("keeps configured and content widths without stretching columns to fill the viewport", () => {
  const layout = getRecordColumnLayout([
    { ...column("selection", 44, "left"), fixedWidth: 44 },
    column("name", 150), column("status", 150),
    { ...column("actions", 180, "right"), fixedWidth: 180 },
  ], { selection: 300, name: 100, actions: 300 });
  expect(layout.width).toBe(474);
  expect(layout.columns.map((c) => c.width)).toEqual([44, 100, 150, 180]);
  expect(layout.columns.at(-1)?.style.right).toBe(0);
});

it("restores content sizing when a configured width is cleared and content changes", () => {
  const columns = [column("name", 150)];
  expect(getRecordColumnLayout(columns, { name: 420 }).columns[0].width).toBe(420);
  expect(getRecordColumnLayout(columns, {}).columns[0].width).toBe(150);
  expect(getRecordColumnLayout([column("name", 280)], {}).columns[0].width).toBe(280);
});

it("persists only widths changed by a resize and restores a different view's widths", () => {
  const columns = [column("name", 150)];
  const updates: Record<string, number>[] = [];
  const { result, rerender } = renderHook(({ saved }) => useRecordTableSizing(columns, saved, (value) => updates.push(value)), {
    initialProps: { saved: { name: 180, hidden: 120 } },
  });
  act(() => result.current.onResizeStart(new Map([["name", 180]])));
  act(() => result.current.onResize(new Map([["name", 240]])));
  expect(result.current.columns[0].width).toBe(240);
  act(() => result.current.onResizeEnd(new Map([["name", 240]])));
  expect(updates).toEqual([{ name: 240, hidden: 120 }]);
  rerender({ saved: { name: 100, hidden: 120 } });
  expect(result.current.columns[0].width).toBe(100);
  expect(changedColumnWidths({ name: 100 }, { name: 100 })).toEqual({});
});
