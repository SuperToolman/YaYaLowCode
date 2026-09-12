"use client";

import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  type ColumnPinningState,
  type TableOptions,
  useReactTable,
} from "@tanstack/react-table";
import { Checkbox, Table, type Selection, type SortDescriptor } from "@heroui/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type MyTableColumnMeta = {
  /** Pin the column to the left or right edge of the scroll viewport. */
  pin?: "left" | "right";
  /** Let the browser size this column from its content instead of forcing TanStack's width. */
  autoWidth?: boolean;
  /** Force a column width and ignore any persisted width from an older view config. */
  fixedWidth?: number;
  headerClassName?: string;
  cellClassName?: string;
};

export type MyTableProps<TData> = {
  ariaLabel: string;
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  getRowId: (row: TData) => string;
  className?: string;
  tableClassName?: string;
  emptyState?: ReactNode;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  selectedRowIds?: Set<string>;
  onSelectedRowIdsChange?: (rowId: string, selected: boolean) => void;
  columnSizing?: Record<string, number>;
  onColumnSizingChange?: (sizing: Record<string, number>) => void;
};

function getPinClass(pin: "left" | "right" | false, isHeader: boolean) {
  if (!pin) return "";
  return [
    "sticky z-20 bg-surface",
    isHeader ? "z-30 bg-surface-secondary" : "",
    pin === "left" ? "shadow-[4px_0_8px_-8px_var(--color-text-secondary)]" : "shadow-[-4px_0_8px_-8px_var(--color-text-secondary)]",
  ].join(" ");
}

function MyTableSortButton({
  children,
  direction,
  onPress,
}: {
  children: ReactNode;
  direction?: SortDescriptor["direction"];
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className="group/sort inline-flex min-w-0 items-center gap-1 text-start outline-none transition-colors duration-[var(--motion-duration)] hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      onClick={onPress}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span
        aria-hidden="true"
        className={`grid size-3 shrink-0 place-items-center text-[var(--color-text-secondary)] transition-transform duration-[var(--motion-duration)] ${direction ? "opacity-100" : "opacity-0 group-hover/sort:opacity-60"}`}
      >
        <span className={`block border-x-[3px] border-x-transparent border-b-[4px] border-b-current transition-transform duration-[var(--motion-duration)] ${direction === "descending" ? "rotate-180" : ""}`} />
      </span>
    </button>
  );
}

export function MyTable<TData>({
  ariaLabel,
  data,
  columns,
  getRowId,
  className,
  tableClassName,
  emptyState,
  sortDescriptor,
  onSortChange,
  selectedRowIds,
  onSelectedRowIdsChange,
  columnSizing,
  onColumnSizingChange,
}: MyTableProps<TData>) {
  const [liveColumnWidths, setLiveColumnWidths] = useState<Record<string, number>>({});
  const resizableContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const columnPinning = useMemo<ColumnPinningState>(() => ({
    left: columns.filter((column) => column.meta && (column.meta as MyTableColumnMeta).pin === "left").map((column) => String(column.id)),
    right: columns.filter((column) => column.meta && (column.meta as MyTableColumnMeta).pin === "right").map((column) => String(column.id)),
  }), [columns]);
  const baseColumnSizing = useMemo(() => Object.fromEntries(columns.map((column) => {
    const id = String(column.id);
    const meta = column.meta as MyTableColumnMeta | undefined;
    if (meta?.fixedWidth !== undefined) return [id, meta.fixedWidth];
    const configuredWidth = liveColumnWidths[id] ?? columnSizing?.[id] ?? column.size ?? 150;
    return [id, Math.max(column.minSize ?? 80, configuredWidth)];
  })), [columnSizing, columns, liveColumnWidths]);
  const fillColumnId = useMemo(() => [...columns].reverse().find((column) => {
    const meta = column.meta as MyTableColumnMeta | undefined;
    return column.id !== "actions" && meta?.pin !== "right";
  })?.id ? String([...columns].reverse().find((column) => {
    const meta = column.meta as MyTableColumnMeta | undefined;
    return column.id !== "actions" && meta?.pin !== "right";
  })?.id) : undefined, [columns]);
  const effectiveColumnSizing = useMemo(() => {
    const sizing = { ...baseColumnSizing };
    const total = Object.values(sizing).reduce((sum, width) => sum + Number(width), 0);
    if (fillColumnId && viewportWidth > total) sizing[fillColumnId] += viewportWidth - total;
    return sizing;
  }, [baseColumnSizing, fillColumnId, viewportWidth]);
  useEffect(() => {
    const element = resizableContainerRef.current;
    if (!element) return;
    const updateWidth = () => setViewportWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // TanStack Table is intentionally used as the state/model layer; the DOM is rendered here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      columnPinning,
      columnSizing: effectiveColumnSizing,
    },
    manualSorting: true,
    // TanStack only exposes the capability flag here. HeroUI owns the actual
    // resize gesture, live updates, and persistence callbacks below.
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
  } satisfies TableOptions<TData>);
  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const tableWidth = table.getVisibleLeafColumns().reduce((total, column) => total + column.getSize(), 0);
  const recordColumnSizing = (widths: Map<unknown, unknown>) => Object.fromEntries([...widths].map(([key, value]) => [String(key), Number(value)]));
  // HeroUI/React Aria requires a real row-header column. Keep the selection
  // column as a control column and prefer the first data column when present.
  const rowHeaderColumnId = table.getVisibleLeafColumns().find((column) => column.id !== "selection")?.id
    ?? table.getVisibleLeafColumns()[0]?.id;

  return (
    <div className={`my-table-resizable h-full min-h-0 min-w-0 flex-1 overflow-hidden ${className ?? ""}`}>
      <Table className="my-table-root flex h-full min-h-0 min-w-0 flex-col">
        <Table.ResizableContainer
          ref={resizableContainerRef}
          className="my-table-scroll data-table-horizontal-scroll min-h-0 min-w-0 flex-1 basis-0 overflow-auto"
          onResize={(widths) => setLiveColumnWidths(recordColumnSizing(widths))}
          onResizeEnd={(widths) => {
            const nextSizing = recordColumnSizing(widths);
            setLiveColumnWidths(nextSizing);
            onColumnSizingChange?.({ ...columnSizing, ...nextSizing });
          }}
        >
        <Table.Content
          aria-label={ariaLabel}
          className={`my-table-content h-auto w-max ${tableClassName ?? ""}`}
          style={{ width: tableWidth, minWidth: tableWidth }}
          selectionMode={onSelectedRowIdsChange ? "multiple" : "none"}
          selectedKeys={selectedRowIds}
          onSelectionChange={(keys: Selection) => {
            if (!onSelectedRowIdsChange) return;
            const nextSelectedIds = keys === "all" ? new Set(data.map(getRowId)) : new Set([...keys].map(String));
            data.forEach((row) => onSelectedRowIdsChange(getRowId(row), nextSelectedIds.has(getRowId(row))));
          }}
          sortDescriptor={sortDescriptor}
          onSortChange={(descriptor) => onSortChange?.(descriptor)}
        >
          <Table.Header>
            {headerGroups[0]?.headers ? [...headerGroups[0].headers].sort((a, b) => {
                const pinOrder = (header: typeof a) => header.column.getIsPinned() === "left" ? 0 : header.column.getIsPinned() === "right" ? 2 : 1;
                return pinOrder(a) - pinOrder(b);
              }).map((header) => {
                const meta = header.column.columnDef.meta as MyTableColumnMeta | undefined;
                const pin = header.column.getIsPinned();
                const width = meta?.fixedWidth ?? header.column.getSize();
                const autoWidth = meta?.autoWidth === true;
                const style = { left: pin === "left" ? header.column.getStart("left") : undefined, right: pin === "right" ? header.column.getAfter("right") : undefined } as CSSProperties;
                const isSelectionColumn = header.column.id === "selection";
                const isActionsColumn = header.column.id === "actions";
                const fixedWidth = meta?.fixedWidth ?? (isSelectionColumn ? 44 : isActionsColumn ? 180 : undefined);
                return <Table.Column key={header.id} id={header.column.id} width={autoWidth ? undefined : fixedWidth ?? width} defaultWidth={autoWidth ? undefined : fixedWidth ?? width} minWidth={fixedWidth ?? header.column.columnDef.minSize ?? 80} maxWidth={fixedWidth} isRowHeader={header.column.id === rowHeaderColumnId} allowsSorting={false} className={`my-table-column relative whitespace-nowrap !p-[6px] !text-[12px] !font-normal !leading-[1.25] ${autoWidth ? "!w-auto" : ""} ${isSelectionColumn ? "my-table-selection-column" : ""} ${getPinClass(pin, true)} ${meta?.headerClassName ?? ""}`} style={style}>
                  {header.isPlaceholder ? null : <div className={isSelectionColumn ? "flex items-center justify-center !text-[12px] !font-normal" : "contents"}>{header.column.getCanSort() ? <MyTableSortButton direction={sortDescriptor && String(sortDescriptor.column) === header.column.id ? sortDescriptor.direction : undefined} onPress={() => {
                    const active = sortDescriptor && String(sortDescriptor.column) === header.column.id;
                    onSortChange?.({ column: header.column.id, direction: active && sortDescriptor.direction === "ascending" ? "descending" : "ascending" });
                  }}>{flexRender(header.column.columnDef.header, header.getContext())}</MyTableSortButton> : flexRender(header.column.columnDef.header, header.getContext())}</div>}
                  {!isSelectionColumn && !isActionsColumn ? <Table.ColumnResizer aria-label={`调整${String(header.column.columnDef.header ?? header.column.id)}列宽`} /> : null}
                </Table.Column>;
              }) : null}
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? <Table.Row className="!h-auto"><Table.Cell colSpan={table.getVisibleLeafColumns().length} className="py-12 text-center">{emptyState}</Table.Cell></Table.Row> : rows.map((row) => (
            <Table.Row key={row.id} id={row.id} className="group !h-auto">
              {[...row.getVisibleCells()].sort((a, b) => {
                const pinOrder = (cell: typeof a) => cell.column.getIsPinned() === "left" ? 0 : cell.column.getIsPinned() === "right" ? 2 : 1;
                return pinOrder(a) - pinOrder(b);
              }).map((cell) => {
                const pin = cell.column.getIsPinned();
                const meta = cell.column.columnDef.meta as MyTableColumnMeta | undefined;
                const autoWidth = meta?.autoWidth === true;
                const width = meta?.fixedWidth ?? cell.column.getSize();
                const style = { left: pin === "left" ? cell.column.getStart("left") : undefined, right: pin === "right" ? cell.column.getAfter("right") : undefined } as CSSProperties;
                const isSelectionCell = cell.column.id === "selection";
                return <Table.Cell key={cell.id} className={`my-table-cell relative !p-[6px] !text-[12px] !font-normal !leading-[1.25] ${autoWidth ? "!w-auto" : ""} ${isSelectionCell ? "my-table-selection-cell" : ""} ${getPinClass(pin, false)} ${meta?.cellClassName ?? ""}`} style={style}>{isSelectionCell ? <div className="!text-[12px] !font-normal !leading-[1.25]">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div> : flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Cell>;
              })}
            </Table.Row>
          ))}
          </Table.Body>
        </Table.Content>
        </Table.ResizableContainer>
      </Table>
    </div>
  );
}

export function MyTableCheckbox({ ariaLabel, isSelected, isIndeterminate, onChange }: { ariaLabel: string; isSelected: boolean; isIndeterminate?: boolean; onChange?: (selected: boolean) => void }) {
  return <Checkbox slot="selection" aria-label={ariaLabel} isSelected={isSelected} isIndeterminate={isIndeterminate} onChange={onChange}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>;
}
