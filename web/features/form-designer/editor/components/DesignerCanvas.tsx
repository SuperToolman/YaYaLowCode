"use client";

import type { MouseEvent, PointerEvent, RefObject, CSSProperties, ReactNode } from "react";
import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button, ButtonGroup, Card } from "@heroui/react";
import { SubformHeader, SubformPagination } from "@/features/form-runtime/components/SubformLayout";
import { CELL_MIN_HEIGHT, COLUMN_COUNT, GRID_COLUMN_GAP, GRID_ROW_GAP } from "../designer-constants";
import { createDesignerCells, getComponentResizeCapabilities, getTopLevelFields, isTopAlignedField } from "../designer-layout";
import type { DesignerDropData, DesignerInsertionIndicator, PlacedField, ResizeDirection } from "../designer-types";
import { RuntimeFieldNode } from "@/features/form-runtime/components/RuntimeFormRenderer";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";
import { MySurface } from "@/shared/ui/MySurface";
import { FormGroup } from "@/features/form-runtime/components/FormGroup";
import { getFormGridTemplateRows } from "@/features/form-runtime/components/form-grid-layout";

const EMPTY_VALUES = Object.freeze({});
const EMPTY_ASSETS: [] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_FIELDS: PlacedField[] = [];
function indexCells(fields: PlacedField[]) {
  const byCell = new Map<string, PlacedField>();
  const covered = new Set<string>();
  for (const field of fields) {
    byCell.set(`${field.row}:${field.column}`, field);
    for (let row = field.row; row < field.row + field.rowSpan; row++)
      for (let column = field.column; column < field.column + field.colSpan; column++) covered.add(`${row}:${column}`);
  }
  return { byCell, covered };
}

type DesignerCanvasProps = {
  fields: PlacedField[];
  gridRef: RefObject<HTMLDivElement | null>;
  insertionIndicator: DesignerInsertionIndicator | null;
  rowCount: number;
  selectedFieldId: string | null;
  showMatrix: boolean;
  onCanvasClick: () => void;
  onFieldSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: () => void;
  onResizePointerCancel: () => void;
};

const InsertionIndicatorContext =
  createContext<DesignerCanvasProps["insertionIndicator"]>(null);

export const DesignerCanvas = memo(function DesignerCanvas({
  fields,
  gridRef,
  insertionIndicator,
  rowCount,
  selectedFieldId,
  showMatrix,
  onCanvasClick,
  onFieldSelect,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
}: DesignerCanvasProps) {
  const cells = useMemo(() => createDesignerCells(rowCount), [rowCount]);
  const previousFieldRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const previousLayoutsRef = useRef<Map<string, { row: number; rowSpan: number; signature: string }>>(new Map());
  const fieldAnimationsRef = useRef<Map<string, Animation>>(new Map());
  const topLevelFields = useMemo(() => getTopLevelFields(fields), [fields]);
  const childFieldsByParent = useMemo(() => {
    const children = new Map<string, PlacedField[]>();
    for (const field of fields) {
      if (!field.parentGroupId) continue;
      const list = children.get(field.parentGroupId) ?? [];
      list.push(field);
      children.set(field.parentGroupId, list);
    }
    return children;
  }, [fields]);
  const { coveredCellKeys, fieldByCell } = useMemo(() => {
    const nextCoveredCellKeys = new Set<string>();
    const nextFieldByCell = new Map<string, PlacedField>();

    for (const field of topLevelFields) {
      nextFieldByCell.set(`${field.row}:${field.column}`, field);
      for (let row = field.row; row < field.row + field.rowSpan; row += 1) {
        for (
          let column = field.column;
          column < field.column + field.colSpan;
          column += 1
        ) {
          nextCoveredCellKeys.add(`${row}:${column}`);
        }
      }
    }

    return {
      coveredCellKeys: nextCoveredCellKeys,
      fieldByCell: nextFieldByCell,
    };
  }, [topLevelFields]);
  const descriptionRows = useMemo(
    () =>
      new Set(
        topLevelFields
          .filter((field) => field.props.description?.trim())
          .map((field) => field.row),
      ),
    [topLevelFields],
  );
  const layouts = useMemo(() => new Map(fields.map((field) => [field.id, {
    row: field.row, rowSpan: field.rowSpan,
    signature: `${field.row}:${field.column}:${field.rowSpan}:${field.colSpan}`,
  }])), [fields]);

  useLayoutEffect(() => {
    const canvas = gridRef.current;
    if (!canvas) return;
    const elements = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-designer-field-id]"),
    );
    // Direct manipulation already provides live feedback. Do not synchronously
    // measure every control on each preview frame.
    if (showMatrix) {
      for (const animation of fieldAnimationsRef.current.values()) animation.cancel();
      fieldAnimationsRef.current.clear();
      return;
    }
    let firstAffectedRow = Infinity;
    for (const [id, layout] of layouts) {
      const previous = previousLayoutsRef.current.get(id);
      if (previous?.signature !== layout.signature) firstAffectedRow = Math.min(firstAffectedRow, layout.row, previous?.row ?? layout.row);
    }
    for (const [id, previous] of previousLayoutsRef.current) {
      if (!layouts.has(id)) firstAffectedRow = Math.min(firstAffectedRow, previous.row);
    }
    const nextRects = new Map(previousFieldRectsRef.current);
    for (const id of nextRects.keys()) if (!layouts.has(id)) nextRects.delete(id);
    previousLayoutsRef.current = layouts;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    for (const element of elements) {
      const fieldId = element.dataset.designerFieldId;
      if (!fieldId) continue;
      const layout = layouts.get(fieldId);
      // Changes to an auto-sized grid row can move every following row,
      // including containers spanning it; those form the affected region.
      if (!layout || layout.row + layout.rowSpan <= firstAffectedRow) continue;
      nextRects.set(fieldId, element.getBoundingClientRect());
    }

    for (const element of elements) {
      const fieldId = element.dataset.designerFieldId;
      if (!fieldId) continue;
      const nextRect = nextRects.get(fieldId);
      const previousRect = previousFieldRectsRef.current.get(fieldId);
      if (!nextRect) continue;
      if (!previousRect || reduceMotion) continue;

      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
      if (!element.isConnected) continue;

      const ancestor = element.parentElement?.closest<HTMLElement>(
        "[data-designer-field-id]",
      );
      const ancestorId = ancestor?.dataset.designerFieldId;
      const previousAncestorRect = ancestorId
        ? previousFieldRectsRef.current.get(ancestorId)
        : null;
      const nextAncestorRect = ancestorId ? nextRects.get(ancestorId) : null;
      if (
        previousAncestorRect &&
        nextAncestorRect &&
        Math.abs(previousAncestorRect.left - nextAncestorRect.left - deltaX) <
          1 &&
        Math.abs(previousAncestorRect.top - nextAncestorRect.top - deltaY) < 1
      ) {
        continue;
      }
      try {
        fieldAnimationsRef.current.get(fieldId)?.cancel();
        const animation = element.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
        fieldAnimationsRef.current.set(fieldId, animation);
        void animation.finished
          .catch(() => undefined)
          .finally(() => {
            if (fieldAnimationsRef.current.get(fieldId) === animation) {
              fieldAnimationsRef.current.delete(fieldId);
            }
          });
      } catch {
        // A field can be detached between measurement and animation during DnD.
      }
    }

    previousFieldRectsRef.current = nextRects;
  }, [gridRef, layouts, showMatrix]);

  return (
    <InsertionIndicatorContext.Provider value={insertionIndicator}>
      <Card
        onClick={onCanvasClick}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4"
      >
        {fields.length === 0 && !showMatrix ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[24px] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-sm text-[var(--color-text-secondary)]">
            从左侧拖拽组件开始设计
          </div>
        ) : (
          <div
            ref={gridRef}
            className="grid w-full min-w-0 content-start"
            style={{
              gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(0, 1fr))`,
              gridAutoRows: `minmax(${CELL_MIN_HEIGHT}px, auto)`,
              gridTemplateRows: getFormGridTemplateRows(topLevelFields, 0, rowCount),
              columnGap: GRID_COLUMN_GAP,
              rowGap: GRID_ROW_GAP,
            }}
          >
            {cells.map(({ row, column }) => {
              const cellKey = `${row}:${column}`;
              const field = fieldByCell.get(cellKey);
              const isCovered = coveredCellKeys.has(cellKey);

              if (!field && (!showMatrix || isCovered)) {
                return null;
              }

              return (
                <DesignerDropCell
                  key={`${row}-${column}`}
                  id={`canvas-cell:${row}:${column}`}
                  data={{ kind: "cell", row, column, parentGroupId: null }}
                  allowInsertionZones={Boolean(field)}
                  occupiedFieldId={field?.id}
                  showMatrix={showMatrix}
                  className={[
                    "rounded-2xl transition",
                    showMatrix ? "border border-dashed p-0" : "p-0",
                    field && showMatrix
                      ? "border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1"
                      : "",
                    !field && showMatrix
                      ? "border-[var(--color-border)] bg-[var(--color-bg-subtle)]"
                      : "",
                  ].join(" ")}
                  style={{
                    gridColumn: field
                      ? `${field.column + 1} / span ${field.colSpan}`
                      : column + 1,
                    gridRow: field
                      ? `${field.row + 1} / span ${field.rowSpan}`
                      : row + 1,
                  }}
                >
                  {field ? (
                    <PlacedDesignerField
                      allFields={fields}
                      childFieldsByParent={childFieldsByParent}
                      field={field}
                      isSelected={selectedFieldId === field.id}
                      selectedFieldId={selectedFieldId}
                      isTopAligned={
                        isTopAlignedField(field.type) ||
                        descriptionRows.has(field.row) ||
                        field.rowSpan > 1
                      }
                      onResizePointerDown={onResizePointerDown}
                      onResizePointerMove={onResizePointerMove}
                      onResizePointerUp={onResizePointerUp}
                      onResizePointerCancel={onResizePointerCancel}
                      onSelect={onFieldSelect}
                    />
                  ) : null}
                </DesignerDropCell>
              );
            })}
          </div>
        )}
      </Card>
    </InsertionIndicatorContext.Provider>
  );
});

const PlacedDesignerField = memo(function PlacedDesignerField({
  allFields,
  childFieldsByParent,
  field,
  isSelected,
  selectedFieldId,
  isTopAligned,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
  onSelect,
}: {
  allFields: PlacedField[];
  childFieldsByParent: Map<string, PlacedField[]>;
  field: PlacedField;
  isSelected: boolean;
  selectedFieldId: string | null;
  isTopAligned: boolean;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: () => void;
  onResizePointerCancel: () => void;
  onSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `field:${field.id}`,
    data: {
      kind: "field",
      fieldId: field.id,
    },
  });
  const resizeCapabilities = getComponentResizeCapabilities(field.type);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(event) => onSelect(event, field.id)}
      onDoubleClick={(event) => event.stopPropagation()}
      data-designer-field-id={field.id}
      className={[
        "relative flex min-w-0 w-full cursor-grab select-none p-0 transition active:cursor-grabbing [&_input]:caret-transparent [&_input]:select-none [&_textarea]:caret-transparent [&_textarea]:select-none",
        isDragging ? "opacity-35" : "",
        field.type === "separator" ||
        field.rowSpan > 1 ||
        field.type === "multiLineText" ||
        field.type === "richText"
          ? "h-full items-stretch"
          : isTopAligned
            ? "min-h-full items-start"
            : "h-full items-end",
        isSelected
          ? "rounded-xl outline outline-1 outline-[var(--color-primary)] outline-offset-2"
          : "",
      ].join(" ")}
      style={{ touchAction: "none" }}
    >
      {isSelected ? (
        <>
          {resizeCapabilities.columns ? (
            <ResizeHandle
              ariaLabel="调整列跨度"
              className={field.type === "separator"
                ? "right-[-5px] top-1/2 h-4 w-2 -translate-y-1/2 cursor-ew-resize"
                : "right-[-5px] top-1/2 h-12 w-2 -translate-y-1/2 cursor-ew-resize"}
              direction="columns"
              field={field}
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerCancel}
            />
          ) : null}
          {resizeCapabilities.rows ? (
            <ResizeHandle
              ariaLabel="调整行跨度"
              className="bottom-[-5px] left-1/2 h-2 w-12 -translate-x-1/2 cursor-ns-resize"
              direction="rows"
              field={field}
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerCancel}
            />
          ) : null}
          {resizeCapabilities.columns && resizeCapabilities.rows ? (
            <ResizeHandle
              ariaLabel="同时调整行列跨度"
              className="bottom-[-6px] right-[-6px] h-4 w-4 cursor-nwse-resize rounded-full"
              direction="both"
              field={field}
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerCancel}
            />
          ) : null}
        </>
      ) : null}
      {field.type === "subform" ? (
        <SubformFieldCanvas
          allFields={allFields}
          childFieldsByParent={childFieldsByParent}
          field={field}
          selectedFieldId={selectedFieldId}
          onFieldSelect={onSelect}
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
          onResizePointerCancel={onResizePointerCancel}
        />
      ) : field.type === "groupContainer" ? (
        <GroupedFieldCanvas
          allFields={allFields}
          childFieldsByParent={childFieldsByParent}
          field={field}
          isSelected={isSelected}
          selectedFieldId={selectedFieldId}
          onFieldSelect={onSelect}
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
          onResizePointerCancel={onResizePointerCancel}
        />
      ) : (
        <RuntimeFieldNode
          childFieldsByParent={childFieldsByParent as unknown as Map<string, RuntimeSchemaField[]>}
          definedAssets={EMPTY_ASSETS}
          definedComponentWritableFieldIds={EMPTY_IDS}
          field={field as unknown as RuntimeSchemaField}
          mode="designer"
          value={undefined}
          values={EMPTY_VALUES}
        />
      )}
    </div>
  );
}, (previous, next) => {
  if (previous.field !== next.field || previous.isSelected !== next.isSelected || previous.isTopAligned !== next.isTopAligned
    || previous.onSelect !== next.onSelect || previous.onResizePointerDown !== next.onResizePointerDown
    || previous.onResizePointerMove !== next.onResizePointerMove || previous.onResizePointerUp !== next.onResizePointerUp
    || previous.onResizePointerCancel !== next.onResizePointerCancel) return false;
  if (previous.field.type === "groupContainer" || previous.field.type === "subform")
    return previous.allFields === next.allFields && previous.selectedFieldId === next.selectedFieldId;
  return true;
});

function SubformFieldCanvas({
  allFields,
  childFieldsByParent,
  field,
  selectedFieldId,
  onFieldSelect,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
}: {
  allFields: PlacedField[];
  childFieldsByParent: Map<string, PlacedField[]>;
  field: PlacedField;
  selectedFieldId: string | null;
  onFieldSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: () => void;
  onResizePointerCancel: () => void;
}) {
  const childFields = useMemo(() => [...(childFieldsByParent.get(field.id) ?? [])].sort(
    (left, right) => left.row - right.row || left.column - right.column,
  ), [childFieldsByParent, field.id]);
  const cellIndex = useMemo(() => indexCells(childFields), [childFields]);
  const rowCount = Math.max(1, ...childFields.map((child) => child.row - field.row + 1));
  return (
    <section className="w-full min-w-0 space-y-3">
      <SubformHeader label={field.label} description={field.props.description}>
        <ButtonGroup>
          {field.props.subformAllowBatchImport ? <Button size="sm" variant="secondary" isDisabled>批量导入</Button> : null}
          {field.props.subformAllowExcelExport ? <Button size="sm" variant="secondary" isDisabled>导出 Excel</Button> : null}
          {!field.props.isDisabled && !field.props.isReadOnly && field.props.subformButtonState !== "hidden" ? (
            <Button size="sm" isDisabled>{field.props.subformAddButtonText ?? "新增一项"}</Button>
          ) : null}
        </ButtonGroup>
      </SubformHeader>
      <MySurface className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl p-2">
      <div
        className="min-w-0 max-w-full flex-1 overflow-x-scroll [scrollbar-width:auto]! [scrollbar-color:auto]! [&::-webkit-scrollbar]:block! [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-text-secondary)] [&::-webkit-scrollbar-track]:bg-[var(--color-bg-subtle)]"
        onPointerDown={(event) => {
          // Keep the scrollbar interactive without starting a container drag.
          if (event.target === event.currentTarget) event.stopPropagation();
        }}
      >
        <div
          className="grid min-h-[68px]"
          style={{
            gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(160px, 1fr))`,
            gridTemplateRows: `repeat(${rowCount}, minmax(68px, auto))`,
            minWidth: `${COLUMN_COUNT * 160}px`,
          }}
        >
          {Array.from({ length: rowCount * COLUMN_COUNT }, (_, index) => {
            const row = field.row + Math.floor(index / COLUMN_COUNT);
            const column = index % COLUMN_COUNT;
            const nestedField = cellIndex.byCell.get(`${row}:${column}`);
            const isCovered = cellIndex.covered.has(`${row}:${column}`);
            if (!nestedField && isCovered) return null;
            return (
              <DesignerDropCell
                key={`${field.id}-${row}-${column}`}
                id={`subform-cell:${field.id}:${row}:${column}`}
                data={{
                  kind: "cell",
                  row,
                  column,
                  parentGroupId: field.id,
                }}
                allowInsertionZones={Boolean(nestedField)}
                allowRowInsertion={false}
                occupiedFieldId={nestedField?.id}
                showMatrix
                className="min-w-0 p-1"
                style={{
                  gridColumn: `${column + 1} / span ${nestedField?.colSpan ?? 1}`,
                  gridRow: row - field.row + 1,
                }}
              >
                {nestedField ? (
                  <PlacedDesignerField
                    allFields={allFields}
                    childFieldsByParent={childFieldsByParent}
                    field={nestedField}
                    isSelected={selectedFieldId === nestedField.id}
                    selectedFieldId={selectedFieldId}
                    isTopAligned
                    onResizePointerDown={onResizePointerDown}
                    onResizePointerMove={onResizePointerMove}
                    onResizePointerUp={onResizePointerUp}
                    onResizePointerCancel={onResizePointerCancel}
                    onSelect={onFieldSelect}
                  />
                ) : (
                  <div className="flex h-full min-h-[68px] items-center justify-center">
                    拖入字段
                  </div>
                )}
              </DesignerDropCell>
            );
          })}
        </div>
      </div>
      </MySurface>
      <SubformPagination total={0} page={1} pageCount={1} pageSize={Math.max(1, field.props.subformPageSize ?? 20)} />
    </section>
  );
}

function GroupedFieldCanvas({
  allFields,
  childFieldsByParent,
  field,
  isSelected,
  selectedFieldId,
  onFieldSelect,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
}: {
  allFields: PlacedField[];
  childFieldsByParent: Map<string, PlacedField[]>;
  field: PlacedField;
  isSelected: boolean;
  selectedFieldId: string | null;
  onFieldSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: () => void;
  onResizePointerCancel: () => void;
}) {
  const childFields = childFieldsByParent.get(field.id) ?? EMPTY_FIELDS;
  const cellIndex = useMemo(() => indexCells(childFields), [childFields]);
  const nestedCells = Array.from(
    { length: field.rowSpan * field.colSpan },
    (_, index) => ({
      row: field.row + Math.floor(index / field.colSpan),
      column: field.column + (index % field.colSpan),
    }),
  );
  return (
    <FormGroup
      title={<span className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{field.label}</span>{isSelected ? <span className="shrink-0 text-xs font-normal">已选中</span> : null}</span>}
      description={field.props.description}
      groupStyle={field.props.groupStyle}
      groupTitleType={field.props.groupTitleType}
      className="flex h-full min-h-0 flex-col"
    >
      <div
        className="grid min-h-0 min-w-0 flex-1 content-start"
        style={{
          gridTemplateColumns: `repeat(${field.colSpan}, minmax(0, 1fr))`,
          gridAutoRows: `minmax(${CELL_MIN_HEIGHT}px, auto)`,
          gridTemplateRows: getFormGridTemplateRows(childFields, field.row, field.rowSpan),
          columnGap: GRID_COLUMN_GAP,
          rowGap: GRID_ROW_GAP,
        }}
      >
        {nestedCells.map(({ row, column }) => {
          const nestedField = cellIndex.byCell.get(`${row}:${column}`);
          if (!nestedField && cellIndex.covered.has(`${row}:${column}`))
            return null;
          return (
            <DesignerDropCell
              key={`${field.id}-${row}-${column}`}
              id={`group-cell:${field.id}:${row}:${column}`}
              data={{ kind: "cell", row, column, parentGroupId: field.id }}
              allowInsertionZones={Boolean(nestedField)}
              occupiedFieldId={nestedField?.id}
              showMatrix
              className="p-0"
              style={{
                gridColumn: nestedField
                  ? `${nestedField.column - field.column + 1} / span ${nestedField.colSpan}`
                  : column - field.column + 1,
                gridRow: nestedField
                  ? `${nestedField.row - field.row + 1} / span ${nestedField.rowSpan}`
                  : row - field.row + 1,
              }}
            >
              {nestedField ? (
                <PlacedDesignerField
                  allFields={allFields}
                  childFieldsByParent={childFieldsByParent}
                  field={nestedField}
                  isSelected={selectedFieldId === nestedField.id}
                  selectedFieldId={selectedFieldId}
                  isTopAligned={
                    isTopAlignedField(nestedField.type) ||
                    nestedField.rowSpan > 1
                  }
                  onResizePointerDown={onResizePointerDown}
                  onResizePointerMove={onResizePointerMove}
                  onResizePointerUp={onResizePointerUp}
                  onResizePointerCancel={onResizePointerCancel}
                  onSelect={onFieldSelect}
                />
              ) : null}
            </DesignerDropCell>
          );
        })}
      </div>
    </FormGroup>
  );
}

function DesignerDropCell({
  children,
  allowInsertionZones = true,
  allowRowInsertion = true,
  className,
  data,
  id,
  occupiedFieldId,
  showMatrix,
  style,
}: {
  children?: ReactNode;
  allowInsertionZones?: boolean;
  allowRowInsertion?: boolean;
  className: string;
  data: DesignerDropData;
  id: string;
  occupiedFieldId?: string;
  showMatrix: boolean;
  style: CSSProperties;
}) {
  const insertionIndicator = useContext(InsertionIndicatorContext);
  const resolvedData: DesignerDropData =
    occupiedFieldId && allowInsertionZones
      ? { ...data, targetFieldId: occupiedFieldId, allowRowInsertion }
      : data;
  const { isOver, setNodeRef } = useDroppable({ id, data: resolvedData });

  return (
    <div
      ref={setNodeRef}
      data-designer-drop-id={id}
      className={[
        "relative min-w-0",
        className,
        isOver && showMatrix
          ? "border border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
          : "",
      ].join(" ")}
      style={style}
    >
      {children}
      {occupiedFieldId && allowInsertionZones && isOver && showMatrix ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
          {allowRowInsertion ? (
            <>
              <div className="absolute inset-x-0 top-0 h-[9%] border-t border-dashed border-[var(--color-primary)] bg-[var(--color-primary-soft)]/35" />
              <div className="absolute inset-x-0 bottom-0 h-[9%] border-b border-dashed border-[var(--color-primary)] bg-[var(--color-primary-soft)]/35" />
            </>
          ) : null}
          <div className="absolute inset-y-0 left-0 w-[8%] border-l border-dashed border-[var(--color-primary)] bg-[var(--color-primary-soft)]/35" />
          <div className="absolute inset-y-0 right-0 w-[8%] border-r border-dashed border-[var(--color-primary)] bg-[var(--color-primary-soft)]/35" />
        </div>
      ) : null}
      {occupiedFieldId &&
      insertionIndicator?.kind === "edge" &&
      insertionIndicator.fieldId === occupiedFieldId ? (
        <div
          aria-hidden
          className={[
            "pointer-events-none absolute z-30 rounded-full bg-[var(--color-primary)] shadow-[0_0_0_3px_var(--color-primary-soft)]",
            insertionIndicator.direction === "before-row"
              ? "inset-x-1 top-0 h-1"
              : insertionIndicator.direction === "after-row"
                ? "inset-x-1 bottom-0 h-1"
                : insertionIndicator.direction === "before-column"
                  ? "bottom-1 left-0 top-1 w-1"
                  : "bottom-1 right-0 top-1 w-1",
          ].join(" ")}
        />
      ) : null}
    </div>
  );
}

function ResizeHandle({
  ariaLabel,
  className,
  direction,
  field,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  ariaLabel: string;
  className: string;
  direction: ResizeDirection;
  field: PlacedField;
  onPointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      type="button"
      onPointerDown={(event) => onPointerDown(event, field, direction)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={[
        "absolute z-10 bg-[var(--color-primary)] opacity-80 transition hover:opacity-100",
        className,
      ].join(" ")}
    />
  );
}
