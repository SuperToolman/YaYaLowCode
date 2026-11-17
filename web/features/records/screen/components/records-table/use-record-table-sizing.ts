"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { RecordDataColumn } from "./record-table-types";

export function safeColumnWidth(width: number | undefined, fallback: number) {
  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : fallback;
}

export function changedColumnWidths(start: Record<string, number>, end: Record<string, number>) {
  return Object.fromEntries(Object.entries(end).filter(([id, width]) =>
    start[id] !== undefined && start[id] !== width,
  ));
}

export function getRecordColumnLayout(columns: RecordDataColumn[], widths: Record<string, number>) {
  const ordered = [
    ...columns.filter((column) => column.pin === "left"),
    ...columns.filter((column) => !column.pin),
    ...columns.filter((column) => column.pin === "right"),
  ];
  const sizes = new Map(ordered.map((column) => {
    const min = safeColumnWidth(column.minSize, 80);
    const max = Math.max(min, safeColumnWidth(column.maxSize, Infinity));
    return [column.id, column.fixedWidth !== undefined
      ? safeColumnWidth(column.fixedWidth, 80)
      : Math.min(max, Math.max(min, safeColumnWidth(widths[column.id], safeColumnWidth(column.size, 150))))];
  }));
  let left = 0;
  let right = ordered.filter((column) => column.pin === "right").reduce((sum, column) => sum + sizes.get(column.id)!, 0);
  const layout = ordered.map((column) => {
    const width = sizes.get(column.id)!;
    const style: CSSProperties = {};
    if (column.pin === "left") {
      style.left = left;
      left += width;
    } else if (column.pin === "right") {
      right -= width;
      style.right = right;
    }
    const minWidth = column.fixedWidth !== undefined ? width : safeColumnWidth(column.minSize, 80);
    const maxWidth = column.fixedWidth !== undefined ? width
      : column.maxSize !== undefined ? Math.max(minWidth, safeColumnWidth(column.maxSize, width)) : undefined;
    return { ...column, width, minWidth, maxWidth, style };
  });
  return { columns: layout, width: [...sizes.values()].reduce((sum, size) => sum + size, 0) };
}

// HeroUI owns resizing. The same widths drive its columns and the sticky offsets.
export function useRecordTableSizing(
  columns: RecordDataColumn[],
  savedWidths: Record<string, number>,
  onChange: (widths: Record<string, number>) => void,
) {
  const [live, setLive] = useState<{ source: Record<string, number>; widths: Record<string, number> } | null>(null);
  const startWidths = useRef<Record<string, number> | null>(null);
  const widths = live?.source === savedWidths ? live.widths : savedWidths;
  const layout = useMemo(() => getRecordColumnLayout(columns, widths), [columns, widths]);
  function recordWidths(values: Map<unknown, unknown>) {
    return Object.fromEntries([...values].flatMap(([id, value]) =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? [[String(id), value]] : [],
    ));
  }
  return {
    ...layout,
    onResizeStart: (values: Map<unknown, unknown>) => { startWidths.current = recordWidths(values); },
    onResize: (values: Map<unknown, unknown>) => { setLive({ source: savedWidths, widths: recordWidths(values) }); },
    onResizeEnd: (values: Map<unknown, unknown>) => {
      const next = recordWidths(values);
      setLive({ source: savedWidths, widths: next });
      const changed = startWidths.current ? changedColumnWidths(startWidths.current, next) : {};
      startWidths.current = null;
      if (Object.keys(changed).length > 0) onChange({ ...savedWidths, ...changed });
    },
  };
}
