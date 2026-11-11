"use client";

import { flexRender, getCoreRowModel, type ColumnDef, type ColumnPinningState, type TableOptions, type Row, useReactTable } from "@tanstack/react-table";
import { Button, Checkbox, Table, type SortDescriptor, type Selection } from "@heroui/react";
import { ArrowChevronRight } from "@gravity-ui/icons";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./MyTable.module.css";

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
  getSubRows?: (row: TData) => TData[] | undefined;
  treeColumn?: string;
  showTreeExpander?: boolean;
  isExpandableRow?: (row: TData) => boolean;
  expandedKeys?: Selection;
  onExpandedChange?: (keys: Selection) => void;
  className?: string;
  tableClassName?: string;
  emptyState?: ReactNode;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  selectedRowIds?: Set<string>;
  columnSizing?: Record<string, number>;
  onColumnSizingChange?: (sizing: Record<string, number>) => void;
};

export function getChangedColumnWidths(
  startWidths: Record<string, number>,
  endWidths: Record<string, number>,
) {
  return Object.fromEntries(
    Object.entries(endWidths).filter(
      ([id, width]) =>
        startWidths[id] !== undefined && startWidths[id] !== width,
    ),
  );
}

// Never pass NaN/Infinity to React Aria's column layout: its flex sizing
// algorithm cannot settle when a minimum width is NaN.
export function getSafeColumnWidth(width: number | undefined, fallback: number) {
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? width
    : fallback;
}

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
  getSubRows,
  treeColumn,
  showTreeExpander = true,
  isExpandableRow,
  expandedKeys: controlledExpandedKeys,
  onExpandedChange,
  className,
  tableClassName,
  emptyState,
  sortDescriptor,
  onSortChange,
  selectedRowIds,
  columnSizing,
  onColumnSizingChange,
}: MyTableProps<TData>) {
  const [internalExpandedKeys, setInternalExpandedKeys] = useState<Selection>(new Set());
  const expandedKeys = controlledExpandedKeys ?? internalExpandedKeys;
  const handleExpandedChange = (keys: Selection) => {
    if (controlledExpandedKeys === undefined) setInternalExpandedKeys(keys);
    onExpandedChange?.(keys);
  };
  const [liveColumnWidths, setLiveColumnWidths] = useState<Record<string, number>>({});
  const resizeStartWidthsRef = useRef<Record<string, number> | null>(null);
  const resizableContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setLiveColumnWidths({});
  }, [columnSizing]);
  const columnPinning = useMemo<ColumnPinningState>(() => ({
    left: columns.filter((column) => column.meta && (column.meta as MyTableColumnMeta).pin === "left").map((column) => String(column.id)),
    right: columns.filter((column) => column.meta && (column.meta as MyTableColumnMeta).pin === "right").map((column) => String(column.id)),
  }), [columns]);
  const baseColumnSizing = useMemo(() => Object.fromEntries(columns.map((column) => {
    const id = String(column.id);
    const meta = column.meta as MyTableColumnMeta | undefined;
    if (meta?.fixedWidth !== undefined) return [id, getSafeColumnWidth(meta.fixedWidth, 80)];
    const configuredWidth = liveColumnWidths[id] ?? columnSizing?.[id] ?? column.size ?? 150;
    return [id, Math.max(getSafeColumnWidth(column.minSize, 80), getSafeColumnWidth(configuredWidth, 150))];
  })), [columnSizing, columns, liveColumnWidths]);
  // TanStack Table is intentionally used as the state/model layer; the DOM is rendered here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getSubRows,
    state: {
      columnPinning,
      columnSizing: baseColumnSizing,
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

  function renderRow(row: Row<TData>): ReactNode {
    return (
            <Table.Row key={row.id} id={row.id} data-selected={selectedRowIds?.has(row.id) || undefined} className="group !h-auto" textValue={row.id}>
              {[...row.getVisibleCells()].sort((a, b) => {
                const pinOrder = (cell: typeof a) => cell.column.getIsPinned() === "left" ? 0 : cell.column.getIsPinned() === "right" ? 2 : 1;
                return pinOrder(a) - pinOrder(b);
              }).map((cell) => {
                const pin = cell.column.getIsPinned();
                const meta = cell.column.columnDef.meta as MyTableColumnMeta | undefined;
                const autoWidth = meta?.autoWidth === true;
                const style = { left: pin === "left" ? cell.column.getStart("left") : undefined, right: pin === "right" ? cell.column.getAfter("right") : undefined } as CSSProperties;
                const isSelectionCell = cell.column.id === "selection";
                const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                return (
                  <Table.Cell key={cell.id} className={`my-table-cell relative !p-[6px] !text-[12px] !font-normal !leading-[1.25] ${autoWidth ? "!w-auto" : ""} ${isSelectionCell ? "my-table-selection-cell" : ""} ${getPinClass(pin, false)} ${meta?.cellClassName ?? ""}`} style={style}>
                    {cell.column.id === treeColumn ? ({ hasChildItems, isExpanded }) => (
                      <div className="flex items-center gap-1" style={{ paddingInlineStart: row.depth * 12 }}>
                        {showTreeExpander && (hasChildItems || isExpandableRow?.(row.original)) ? (
                          <Button slot="chevron" isIconOnly size="sm" variant="tertiary" isDisabled={!hasChildItems} aria-label={isExpanded ? "收起子表数据" : "展开子表数据"}>
                            <ArrowChevronRight aria-hidden="true" className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          </Button>
                        ) : null}
                        {content}
                      </div>
                    ) : isSelectionCell ? <div className="!text-[12px] !font-normal !leading-[1.25]">{content}</div> : content}
                  </Table.Cell>
                );
              })}
              {row.subRows.length > 0 ? <Table.Collection items={row.subRows}>{renderRow}</Table.Collection> : null}
            </Table.Row>
    );
  }
  return (
    <div className={`my-table-resizable h-full min-h-0 min-w-0 flex-1 overflow-hidden ${className ?? ""}`}>
      <Table className="my-table-root flex h-full min-h-0 min-w-0 flex-col">
        <Table.ResizableContainer
          ref={resizableContainerRef}
          className={`my-table-scroll ${styles["my-table__horizontal-scroll"]} min-h-0 min-w-0 flex-1 basis-0 overflow-auto`}
          onResizeStart={(widths) => {
            resizeStartWidthsRef.current = recordColumnSizing(widths);
          }}
          onResize={(widths) => setLiveColumnWidths(recordColumnSizing(widths))}
          onResizeEnd={(widths) => {
            const nextSizing = recordColumnSizing(widths);
            const startWidths = resizeStartWidthsRef.current;
            resizeStartWidthsRef.current = null;
            setLiveColumnWidths(nextSizing);
            if (!startWidths) return;
            const changedWidths = getChangedColumnWidths(
              startWidths,
              nextSizing,
            );
            if (Object.keys(changedWidths).length > 0) {
              onColumnSizingChange?.({ ...columnSizing, ...changedWidths });
            }
          }}
        >
        <Table.Content
          aria-label={ariaLabel}
          className={`${styles["my-table__content"]} h-auto w-max ${tableClassName ?? ""}`}
          style={{ width: tableWidth, minWidth: tableWidth }}
          // Selection is controlled exclusively by the explicit checkbox column.
          selectionMode="none"
          treeColumn={treeColumn}
          expandedKeys={treeColumn ? expandedKeys : undefined}
          onExpandedChange={treeColumn ? handleExpandedChange : undefined}
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
                const fixedWidth = meta?.fixedWidth !== undefined ? getSafeColumnWidth(meta.fixedWidth, 80) : (isSelectionColumn ? 44 : isActionsColumn ? 180 : undefined);
                return <Table.Column key={header.id} id={header.column.id} width={autoWidth ? undefined : fixedWidth ?? width} defaultWidth={autoWidth ? undefined : fixedWidth ?? width} minWidth={fixedWidth ?? getSafeColumnWidth(header.column.columnDef.minSize, 80)} maxWidth={fixedWidth} isRowHeader={header.column.id === rowHeaderColumnId} allowsSorting={false} className={`my-table-column relative whitespace-nowrap !p-[6px] !text-[12px] !font-normal !leading-[1.25] ${autoWidth ? "!w-auto" : ""} ${isSelectionColumn ? "my-table-selection-column" : ""} ${getPinClass(pin, true)} ${meta?.headerClassName ?? ""}`} style={style}>
                  {header.isPlaceholder ? null : <div className={isSelectionColumn ? "flex items-center justify-center !text-[12px] !font-normal" : "contents"}>{header.column.getCanSort() ? <MyTableSortButton direction={sortDescriptor && String(sortDescriptor.column) === header.column.id ? sortDescriptor.direction : undefined} onPress={() => {
                    const active = sortDescriptor && String(sortDescriptor.column) === header.column.id;
                    onSortChange?.({ column: header.column.id, direction: active && sortDescriptor.direction === "ascending" ? "descending" : "ascending" });
                  }}>{flexRender(header.column.columnDef.header, header.getContext())}</MyTableSortButton> : flexRender(header.column.columnDef.header, header.getContext())}</div>}
                  {!isSelectionColumn && !isActionsColumn ? <Table.ColumnResizer aria-label={`调整${String(header.column.columnDef.header ?? header.column.id)}列宽`} /> : null}
                </Table.Column>;
              }) : null}
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? <Table.Row className="!h-auto"><Table.Cell colSpan={table.getVisibleLeafColumns().length} className="py-12 text-center">{emptyState}</Table.Cell></Table.Row> : rows.map(renderRow)}
          </Table.Body>
        </Table.Content>
        </Table.ResizableContainer>
      </Table>
    </div>
  );
}

export function MyTableCheckbox({ ariaLabel, isSelected, isIndeterminate, onChange }: { ariaLabel: string; isSelected: boolean; isIndeterminate?: boolean; onChange?: (selected: boolean) => void }) {
  return <Checkbox slot={null} aria-label={ariaLabel} isSelected={isSelected} isIndeterminate={isIndeterminate} onChange={onChange}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>;
}
