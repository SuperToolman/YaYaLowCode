"use client";

import type {
  MouseEvent,
  PointerEvent,
  RefObject,
  CSSProperties,
  ReactNode,
} from "react";
import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { TrashIcon } from "../../../../components/app-icons";
import {
  CELL_MIN_HEIGHT,
  COLUMN_COUNT,
  GRID_COLUMN_GAP,
  GRID_ROW_GAP,
} from "../designer-constants";
import {
  createDesignerCells,
  getChildFields,
  getComponentResizeCapabilities,
  getFieldAt,
  getTopLevelFields,
  isCellCovered,
  isContainerFieldType,
  isTopAlignedField,
} from "../designer-layout";
import type {
  DesignerDropData,
  DesignerInsertionIndicator,
  PlacedField,
  ResizeDirection,
} from "../designer-types";

type DesignerCanvasProps = {
  fields: PlacedField[];
  gridRef: RefObject<HTMLDivElement | null>;
  insertionIndicator: DesignerInsertionIndicator | null;
  rowCount: number;
  selectedFieldId: string | null;
  showMatrix: boolean;
  onCanvasClick: () => void;
  onFieldSelect: (
    event: MouseEvent<HTMLDivElement>,
    fieldId: string,
  ) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: () => void;
};

const InsertionIndicatorContext = createContext<
  DesignerCanvasProps["insertionIndicator"]
>(null);

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
}: DesignerCanvasProps) {
  const cells = useMemo(() => createDesignerCells(rowCount), [rowCount]);
  const previousFieldRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const fieldAnimationsRef = useRef<Map<string, Animation>>(new Map());
  const topLevelFields = useMemo(() => getTopLevelFields(fields), [fields]);
  const { coveredCellKeys, fieldByCell } = useMemo(() => {
    const nextCoveredCellKeys = new Set<string>();
    const nextFieldByCell = new Map<string, PlacedField>();

    for (const field of topLevelFields) {
      nextFieldByCell.set(`${field.row}:${field.column}`, field);
      for (let row = field.row; row < field.row + field.rowSpan; row += 1) {
        for (let column = field.column; column < field.column + field.colSpan; column += 1) {
          nextCoveredCellKeys.add(`${row}:${column}`);
        }
      }
    }

    return { coveredCellKeys: nextCoveredCellKeys, fieldByCell: nextFieldByCell };
  }, [topLevelFields]);
  const descriptionRows = useMemo(
    () => new Set(
      topLevelFields
        .filter((field) => field.props.description?.trim())
        .map((field) => field.row),
    ),
    [topLevelFields],
  );
  const layoutSignature = useMemo(
    () => fields
      .map((field) => `${field.id}:${field.row}:${field.column}:${field.rowSpan}:${field.colSpan}`)
      .join("|"),
    [fields],
  );

  useLayoutEffect(() => {
    const canvas = gridRef.current;
    if (!canvas) return;
    const elements = Array.from(
      canvas.querySelectorAll<HTMLElement>("[data-designer-field-id]"),
    );
    const nextRects = new Map<string, DOMRect>();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const element of elements) {
      const fieldId = element.dataset.designerFieldId;
      if (!fieldId) continue;
      nextRects.set(fieldId, element.getBoundingClientRect());
    }

    // Keep the current geometry during direct manipulation. Animating every resize
    // frame forces repeated compositing work across the entire canvas.
    if (showMatrix) {
      previousFieldRectsRef.current = nextRects;
      return;
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
        Math.abs(previousAncestorRect.left - nextAncestorRect.left - deltaX) < 1 &&
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
  }, [gridRef, layoutSignature, showMatrix]);

  return (
    <InsertionIndicatorContext.Provider value={insertionIndicator}>
    <div
      onClick={onCanvasClick}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-designer)] backdrop-blur"
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
                allowInsertionZones={field ? !isContainerFieldType(field.type) : false}
                occupiedFieldId={field?.id}
                showMatrix={showMatrix}
                className={[
                  "rounded-2xl transition",
                  showMatrix ? "border border-dashed p-0" : "p-0",
                  field && showMatrix ? "border-[var(--color-border)] bg-[var(--color-bg-surface)]" : "",
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
                    field={field}
                    isSelected={selectedFieldId === field.id}
                    selectedFieldId={selectedFieldId}
                    isTopAligned={
                      isTopAlignedField(field.type) ||
                      descriptionRows.has(field.row)
                    }
                    onResizePointerDown={onResizePointerDown}
                    onResizePointerMove={onResizePointerMove}
                    onResizePointerUp={onResizePointerUp}
                    onSelect={onFieldSelect}
                  />
                ) : null}
              </DesignerDropCell>
            );
          })}
        </div>
      )}
    </div>
    </InsertionIndicatorContext.Provider>
  );
});

function PlacedDesignerField({
  allFields,
  field,
  isSelected,
  selectedFieldId,
  isTopAligned,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onSelect,
}: {
  allFields: PlacedField[];
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
        "relative flex cursor-grab p-0 transition active:cursor-grabbing",
        isDragging ? "opacity-35" : "",
        field.type === "multiLineText" ? "h-full items-stretch" : isTopAligned ? "min-h-full items-start" : "h-full items-end",
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
              className="right-[-5px] top-1/2 h-12 w-2 -translate-y-1/2 cursor-ew-resize"
              direction="columns"
              field={field}
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
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
            />
          ) : null}
        </>
      ) : null}
      {field.type === "subform" ? (
        <SubformFieldCanvas
          allFields={allFields}
          field={field}
          selectedFieldId={selectedFieldId}
          onFieldSelect={onSelect}
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
        />
      ) : field.type === "groupContainer" ? (
        <GroupedFieldCanvas
          allFields={allFields}
          field={field}
          isSelected={isSelected}
          selectedFieldId={selectedFieldId}
          onFieldSelect={onSelect}
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
        />
      ) : (
        <DesignerFieldPreview field={field} />
      )}
    </div>
  );
}

function DesignerFieldPreview({ field }: { field: PlacedField }) {
  const props = field.props;
  const placeholder = props.placeholder || "请输入";
  const options = props.options ?? [];
  const description = props.description?.trim();
  const isChoice = field.type === "radio" || field.type === "checkbox";
  const isMultiline = field.type === "multiLineText";
  const isUpload = field.type === "attachment" || field.type === "imageUpload";

  if (field.type === "description") {
    return <p className="w-full rounded-md bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{String(props.defaultValue || placeholder)}</p>;
  }

  if (field.type === "button") {
    return <div className="inline-flex h-9 items-center rounded-md bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-text-on-primary)]">{props.buttonText || field.label}</div>;
  }

  return (
    <div className={isMultiline ? "flex h-full w-full min-w-0 flex-col gap-2" : "w-full min-w-0 space-y-2"}>
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{field.label}</div>
      {isChoice ? (
        <div className="flex flex-wrap gap-3 text-sm text-[var(--color-text-secondary)]">
          {(options.length > 0 ? options : [{ label: "选项一" }, { label: "选项二" }]).map((option, index) => (
            <span key={`${option.label}-${index}`} className="inline-flex items-center gap-1.5"><span className={field.type === "radio" ? "h-3.5 w-3.5 rounded-full border border-[var(--color-border)]" : "h-3.5 w-3.5 rounded border border-[var(--color-border)]"} />{option.label}</span>
          ))}
        </div>
      ) : isUpload ? (
        <div className="flex min-h-12 items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-xs text-[var(--color-text-secondary)]">{props.buttonText || (field.type === "imageUpload" ? "上传图片" : "上传附件")}</div>
      ) : (
        <div className={["flex w-full items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-disabled)]", isMultiline ? "min-h-16 flex-1 items-start py-2" : "h-10"].join(" ")}>{placeholder}</div>
      )}
      {description ? <div className="text-xs text-[var(--color-text-secondary)]">{description}</div> : null}
    </div>
  );
}

function SubformFieldCanvas({ allFields, field, selectedFieldId, onFieldSelect, onResizePointerDown, onResizePointerMove, onResizePointerUp }: { allFields: PlacedField[]; field: PlacedField; selectedFieldId: string | null; onFieldSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void; onResizePointerDown: (event: PointerEvent<HTMLButtonElement>, field: PlacedField, direction: ResizeDirection) => void; onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void; onResizePointerUp: () => void }) {
  const childFields = getChildFields(allFields, field.id).sort(
    (left, right) => left.column - right.column,
  );
  const occupiedColumnCount = childFields.reduce(
    (maximum, child) => Math.max(maximum, child.column + child.colSpan),
    0,
  );
  const columnCount = Math.max(1, occupiedColumnCount + 1);
  const columns = Array.from({ length: columnCount }, (_, index) => ({ row: field.row, column: index }));

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2">
        <div className="min-w-0 truncate text-sm font-semibold">{field.label}</div>
        <span className="text-[10px] text-[var(--color-text-secondary)]">{childFields.length} 个字段 · 可继续添加</span>
      </div>
      <div className="flex min-w-0">
        <div className="subform-horizontal-scroll min-w-0 flex-1 overflow-x-auto">
          <div
            className="grid min-h-[92px] divide-x divide-[var(--color-border)]"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(160px, 1fr))`,
              minWidth: `${columnCount * 160}px`,
            }}
          >
            {columns.map(({ row, column }) => {
              const nestedField = getFieldAt(childFields, row, column);
              const isCovered = isCellCovered(childFields, row, column);
              if (!nestedField && isCovered) return null;
              return (
                <DesignerDropCell
                  key={`${field.id}-${column}`}
                  id={`subform-cell:${field.id}:${row}:${column}`}
                  data={{ kind: "cell", row, column, parentGroupId: field.id }}
                  allowInsertionZones={Boolean(nestedField)}
                  allowRowInsertion={false}
                  occupiedFieldId={nestedField?.id}
                  showMatrix
                  className={nestedField ? "min-w-0 bg-[var(--color-bg-surface)] p-1" : "min-w-0 bg-[var(--color-bg-subtle)] p-1"}
                  style={{ gridColumn: nestedField ? `${nestedField.column + 1} / span ${nestedField.colSpan}` : column + 1, gridRow: 1 }}
                >
                  {nestedField ? (
                    <PlacedDesignerField allFields={allFields} field={nestedField} isSelected={selectedFieldId === nestedField.id} selectedFieldId={selectedFieldId} isTopAligned onResizePointerDown={onResizePointerDown} onResizePointerMove={onResizePointerMove} onResizePointerUp={onResizePointerUp} onSelect={onFieldSelect} />
                  ) : <div className="flex h-full min-h-20 items-center justify-center text-[10px] text-[var(--color-text-disabled)]">拖入字段</div>}
                </DesignerDropCell>
              );
            })}
          </div>
        </div>
        <div className="relative z-20 flex w-20 shrink-0 flex-col items-center justify-center gap-2 border-l border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-[10px] text-[var(--color-text-secondary)] shadow-[-6px_0_12px_-10px_rgba(15,23,42,0.7)]">
          <span>操作</span>
          {field.props.subformShowDeleteButton !== false ? (
            <span
              aria-label={field.props.subformDeleteButtonText ?? "删除"}
              className="text-[var(--color-danger)]"
              role="img"
            >
              <TrashIcon />
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">{field.props.subformAddButtonText ?? "新增一项"}</div>
    </div>
  );
}

function GroupedFieldCanvas({
  allFields,
  field,
  isSelected,
  selectedFieldId,
  onFieldSelect,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: {
  allFields: PlacedField[];
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
}) {
  const childFields = getChildFields(allFields, field.id);
  const nestedCells = Array.from(
    { length: field.rowSpan * field.colSpan },
    (_, index) => ({
      row: field.row + Math.floor(index / field.colSpan),
      column: field.column + (index % field.colSpan),
    }),
  );

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col rounded-lg bg-[var(--color-bg-subtle)] p-1">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {field.label}
        </div>
        {isSelected ? (
          <span className="rounded-full bg-[var(--color-primary-soft)] px-2 py-1 text-[11px] font-medium text-[var(--color-primary)]">
            已选中
          </span>
        ) : null}
      </div>
      <div
        className="grid min-h-[120px] flex-1 content-start rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1"
        style={{
          gridTemplateColumns: `repeat(${field.colSpan}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(56px, auto)",
          gap: 6,
        }}
      >
        {nestedCells.map(({ row, column }) => {
          const nestedField = getFieldAt(childFields, row, column);
          const isCovered = isCellCovered(childFields, row, column);

          if (!nestedField && isCovered) {
            return null;
          }

          return (
            <DesignerDropCell
              key={`${field.id}-${row}-${column}`}
              id={`group-cell:${field.id}:${row}:${column}`}
              data={{ kind: "cell", row, column, parentGroupId: field.id }}
              allowInsertionZones={nestedField ? !isContainerFieldType(nestedField.type) : false}
              occupiedFieldId={nestedField?.id}
              showMatrix
              className={[
                "rounded-md border transition",
                nestedField
                  ? "border-[var(--color-primary)] bg-[var(--color-bg-surface)]"
                  : "border-[var(--color-border)] bg-[var(--color-bg-subtle)]",
              ].join(" ")}
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
                  field={nestedField}
                  isSelected={selectedFieldId === nestedField.id}
                  selectedFieldId={selectedFieldId}
                  isTopAligned={isTopAlignedField(nestedField.type)}
                  onResizePointerDown={onResizePointerDown}
                  onResizePointerMove={onResizePointerMove}
                  onResizePointerUp={onResizePointerUp}
                  onSelect={onFieldSelect}
                />
              ) : null}
            </DesignerDropCell>
          );
        })}
      </div>
    </div>
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
  const resolvedData: DesignerDropData = occupiedFieldId && allowInsertionZones
    ? { ...data, targetFieldId: occupiedFieldId, allowRowInsertion }
    : data;
  const { isOver, setNodeRef } = useDroppable({ id, data: resolvedData });

  return (
    <div
      ref={setNodeRef}
      data-designer-drop-id={id}
      className={[
        "relative",
        className,
        isOver && showMatrix
          ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
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
      {occupiedFieldId && insertionIndicator?.kind === "edge" && insertionIndicator.fieldId === occupiedFieldId ? (
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
}) {
  return (
    <button
      aria-label={ariaLabel}
      type="button"
      onPointerDown={(event) => onPointerDown(event, field, direction)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={[
        "absolute z-10 bg-[var(--color-primary)] opacity-80 transition hover:opacity-100",
        className,
      ].join(" ")}
    />
  );
}
