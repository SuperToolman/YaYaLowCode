"use client";

import type {
  DragEvent,
  MouseEvent,
  PointerEvent,
  RefObject,
} from "react";
import { FieldPreview } from "./CompTool";
import {
  CELL_MIN_HEIGHT,
  COLUMN_COUNT,
  GRID_COLUMN_GAP,
  GRID_ROW_GAP,
} from "../designer-constants";
import {
  createDesignerCells,
  getChildFields,
  getFieldAt,
  getTopLevelFields,
  isCellCovered,
  isTopAlignedField,
} from "../designer-layout";
import type {
  ActiveCell,
  PlacedField,
  ResizeDirection,
} from "../designer-types";

type DesignerCanvasProps = {
  activeCell: ActiveCell | null;
  fields: PlacedField[];
  gridRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  selectedFieldId: string | null;
  showMatrix: boolean;
  onActiveCellChange: (cell: ActiveCell | null) => void;
  onCanvasClick: () => void;
  onCanvasDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    row: number,
    column: number,
  ) => void;
  onDropToGroup: (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    row: number,
    column: number,
  ) => void;
  onFieldPropertiesOpen: (
    event: MouseEvent<HTMLElement>,
    fieldId: string,
  ) => void;
  onFieldSelect: (
    event: MouseEvent<HTMLDivElement>,
    fieldId: string,
  ) => void;
  onPlacedFieldDragEnd: () => void;
  onPlacedFieldDragStart: (
    event: DragEvent<HTMLDivElement>,
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

export function DesignerCanvas({
  activeCell,
  fields,
  gridRef,
  rowCount,
  selectedFieldId,
  showMatrix,
  onActiveCellChange,
  onCanvasClick,
  onCanvasDoubleClick,
  onDragOver,
  onDrop,
  onDropToGroup,
  onFieldPropertiesOpen,
  onFieldSelect,
  onPlacedFieldDragEnd,
  onPlacedFieldDragStart,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: DesignerCanvasProps) {
  const cells = createDesignerCells(rowCount);
  const topLevelFields = getTopLevelFields(fields);
  const descriptionRows = new Set(
    topLevelFields
      .filter((field) => field.props.description?.trim())
      .map((field) => field.row),
  );

  return (
    <div
      onClick={onCanvasClick}
      onDoubleClick={onCanvasDoubleClick}
      className="flex min-h-0 flex-1 flex-col overflow-auto rounded-[28px] border border-[#dce7f5] bg-white/80 p-4 shadow-[0_20px_70px_rgba(31,65,122,0.08)] backdrop-blur"
    >
      {fields.length === 0 && !showMatrix ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[24px] border border-dashed border-[#cbd8ea] bg-[#f7faff] text-sm text-[#7d8da8]">
          从左侧拖拽组件开始设计
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid min-w-[960px] content-start"
          style={{
            gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(0, 1fr))`,
            gridAutoRows: `minmax(${CELL_MIN_HEIGHT}px, auto)`,
            columnGap: GRID_COLUMN_GAP,
            rowGap: GRID_ROW_GAP,
          }}
        >
          {cells.map(({ row, column }) => {
            const field = getFieldAt(topLevelFields, row, column);
            const isCovered = isCellCovered(topLevelFields, row, column);
            const isActive =
              activeCell?.row === row && activeCell.column === column;

            if (!field && (!showMatrix || isCovered)) {
              return null;
            }

            return (
              <div
                key={`${row}-${column}`}
                onDragEnter={() => onActiveCellChange({ row, column })}
                onDragLeave={() => onActiveCellChange(null)}
                onDragOver={onDragOver}
                onDrop={(event) => onDrop(event, row, column)}
                className={[
                  "rounded-2xl transition",
                  showMatrix ? "border border-dashed p-0" : "p-0",
                  field && showMatrix ? "border-[#c8d9ee] bg-white" : "",
                  !field && showMatrix
                    ? "border-[#cfdcee] bg-[#f7faff]/80"
                    : "",
                  isActive && showMatrix
                    ? "border-[#2f6bff] bg-[#eef5ff]"
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
                    onDragEnd={onPlacedFieldDragEnd}
                    onDragStart={onPlacedFieldDragStart}
                    onPropertiesOpen={onFieldPropertiesOpen}
                    onDropToGroup={onDropToGroup}
                    onResizePointerDown={onResizePointerDown}
                    onResizePointerMove={onResizePointerMove}
                    onResizePointerUp={onResizePointerUp}
                    onSelect={onFieldSelect}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlacedDesignerField({
  allFields,
  field,
  isSelected,
  selectedFieldId,
  isTopAligned,
  onDragEnd,
  onDragStart,
  onPropertiesOpen,
  onDropToGroup,
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
  onDragEnd: () => void;
  onDragStart: (
    event: DragEvent<HTMLDivElement>,
    fieldId: string,
  ) => void;
  onPropertiesOpen: (
    event: MouseEvent<HTMLElement>,
    fieldId: string,
  ) => void;
  onDropToGroup: (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    row: number,
    column: number,
  ) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLButtonElement>,
    field: PlacedField,
    direction: ResizeDirection,
  ) => void;
  onResizePointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: () => void;
  onSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void;
}) {
  return (
    <div
      draggable
      onClick={(event) => onSelect(event, field.id)}
      onDoubleClick={(event) => onPropertiesOpen(event, field.id)}
      onDragStart={(event) => onDragStart(event, field.id)}
      onDragEnd={onDragEnd}
      className={[
        "relative flex cursor-grab p-0 transition active:cursor-grabbing",
        isTopAligned ? "min-h-full" : "h-full",
        isTopAligned ? "items-start" : "items-end",
        isSelected
          ? "rounded-xl outline outline-1 outline-[#2f6bff]/70 outline-offset-2"
          : "",
      ].join(" ")}
    >
      {isSelected ? (
        <>
          <button
            type="button"
            aria-label="打开属性配置"
            onClick={(event) => onPropertiesOpen(event, field.id)}
            className="absolute right-0 top-0 z-20 flex h-5 max-h-5 w-5 items-center justify-center rounded-full bg-white/95 text-[#2f6bff] shadow-[0_6px_14px_rgba(31,65,122,0.16)]"
          >
            <SettingsIcon />
          </button>
          <ResizeHandle
            ariaLabel="调整列跨度"
            className="right-[-5px] top-1/2 h-12 w-2 -translate-y-1/2 cursor-ew-resize"
            direction="columns"
            field={field}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <ResizeHandle
            ariaLabel="调整行跨度"
            className="bottom-[-5px] left-1/2 h-2 w-12 -translate-x-1/2 cursor-ns-resize"
            direction="rows"
            field={field}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
          <ResizeHandle
            ariaLabel="同时调整行列跨度"
            className="bottom-[-6px] right-[-6px] h-4 w-4 cursor-nwse-resize rounded-full"
            direction="both"
            field={field}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
        </>
      ) : null}
      {field.type === "groupContainer" ? (
        <GroupedFieldCanvas
          allFields={allFields}
          field={field}
          isSelected={isSelected}
          selectedFieldId={selectedFieldId}
          onDropToGroup={onDropToGroup}
          onFieldPropertiesOpen={onPropertiesOpen}
          onFieldSelect={onSelect}
          onPlacedFieldDragEnd={onDragEnd}
          onPlacedFieldDragStart={onDragStart}
          onResizePointerDown={onResizePointerDown}
          onResizePointerMove={onResizePointerMove}
          onResizePointerUp={onResizePointerUp}
        />
      ) : (
        <FieldPreview
          type={field.type}
          label={field.label}
          compact
          showLabel
          componentProps={field.props}
        />
      )}
    </div>
  );
}

function GroupedFieldCanvas({
  allFields,
  field,
  isSelected,
  selectedFieldId,
  onDropToGroup,
  onFieldPropertiesOpen,
  onFieldSelect,
  onPlacedFieldDragEnd,
  onPlacedFieldDragStart,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: {
  allFields: PlacedField[];
  field: PlacedField;
  isSelected: boolean;
  selectedFieldId: string | null;
  onDropToGroup: (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    row: number,
    column: number,
  ) => void;
  onFieldPropertiesOpen: (
    event: MouseEvent<HTMLElement>,
    fieldId: string,
  ) => void;
  onFieldSelect: (event: MouseEvent<HTMLDivElement>, fieldId: string) => void;
  onPlacedFieldDragEnd: () => void;
  onPlacedFieldDragStart: (
    event: DragEvent<HTMLDivElement>,
    fieldId: string,
  ) => void;
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
    <div className="flex min-h-full w-full flex-col rounded-2xl border border-dashed border-[#b9cff8] bg-[#f7fbff] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#2b4a7f]">
            {field.label}
          </div>
          <div className="text-xs text-[#7c8ca6]">
            {childFields.length} 个子组件
          </div>
        </div>
        {isSelected ? (
          <span className="rounded-full bg-[#e7f0ff] px-2 py-1 text-[11px] font-medium text-[#2f6bff]">
            已选中
          </span>
        ) : null}
      </div>
      <div
        className="grid min-h-[120px] flex-1 content-start rounded-xl border border-dashed border-[#d6e1f4] bg-white/80 p-2"
        style={{
          gridTemplateColumns: `repeat(${field.colSpan}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(56px, auto)",
          gap: 8,
        }}
      >
        {nestedCells.map(({ row, column }) => {
          const nestedField = getFieldAt(childFields, row, column);
          const isCovered = isCellCovered(childFields, row, column);

          if (!nestedField && isCovered) {
            return null;
          }

          return (
            <div
              key={`${field.id}-${row}-${column}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDropToGroup(event, field.id, row, column)}
              className={[
                "rounded-xl border border-dashed transition",
                nestedField ? "border-[#cfe0ff] bg-white" : "border-[#e3ebf7] bg-[#fbfdff]",
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
                  onDragEnd={onPlacedFieldDragEnd}
                  onDragStart={onPlacedFieldDragStart}
                  onPropertiesOpen={onFieldPropertiesOpen}
                  onDropToGroup={onDropToGroup}
                  onResizePointerDown={onResizePointerDown}
                  onResizePointerMove={onResizePointerMove}
                  onResizePointerUp={onResizePointerUp}
                  onSelect={onFieldSelect}
                />
              ) : null}
            </div>
          );
        })}
      </div>
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
        "absolute z-10 bg-[#2f6bff] opacity-80 transition hover:opacity-100",
        className,
      ].join(" ")}
    />
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.4 4.3 11 3h2l.6 1.3 1.4.6 1.3-.5 1.4 1.4-.5 1.3.6 1.4L19 9v2l-1.3.6-.6 1.4.5 1.3-1.4 1.4-1.3-.5-1.4.6L13 17h-2l-.6-1.3-1.4-.6-1.3.5-1.4-1.4.5-1.3-.6-1.4L5 11V9l1.3-.6.6-1.4-.5-1.3 1.4-1.4 1.3.5 1.3-.5Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
      />
    </svg>
  );
}
