import type { DesignerComponentType } from "./components/CompTool";
import {
  COLUMN_COUNT,
  GRID_COLUMN_GAP,
  MIN_ROW_COUNT,
} from "./designer-constants";
import type { PlacedField, ResizeState } from "./designer-types";

type FieldRectangle = Pick<
  PlacedField,
  "row" | "column" | "rowSpan" | "colSpan"
>;

export function createDesignerCells(rowCount: number) {
  return Array.from({ length: rowCount * COLUMN_COUNT }, (_, index) => ({
    row: Math.floor(index / COLUMN_COUNT),
    column: index % COLUMN_COUNT,
  }));
}

export function getRowCount(fields: PlacedField[]) {
  const maxFieldBottom = fields.reduce(
    (maxBottom, field) =>
      field.parentGroupId
        ? maxBottom
        : Math.max(maxBottom, field.row + field.rowSpan),
    0,
  );

  return Math.max(MIN_ROW_COUNT, maxFieldBottom + 1);
}

export function getFieldAt(
  fields: PlacedField[],
  row: number,
  column: number,
) {
  return fields.find((field) => field.row === row && field.column === column);
}

export function isCellCovered(
  fields: PlacedField[],
  row: number,
  column: number,
) {
  return fields.some((field) =>
    rectanglesOverlap({ row, column, rowSpan: 1, colSpan: 1 }, field),
  );
}

export function moveField(
  fields: PlacedField[],
  fieldId: string,
  row: number,
  column: number,
  parentGroupId?: string | null,
) {
  const targetField = fields.find((field) => field.id === fieldId);

  if (!targetField) {
    return fields;
  }

  if (targetField.row === row && targetField.column === column) {
    return fields;
  }

  const nextParentGroupId =
    parentGroupId === undefined ? (targetField?.parentGroupId ?? null) : parentGroupId;

  if (
    !canPlaceField(
      fields,
      fieldId,
      row,
      column,
      targetField.rowSpan,
      targetField.colSpan,
      nextParentGroupId,
    )
  ) {
    return fields;
  }

  if (targetField.type === "groupContainer") {
    const deltaRow = row - targetField.row;
    const deltaColumn = column - targetField.column;
    const descendantIds = collectGroupDescendantIds(fields, targetField.id);

    return fields.map((field) => {
      if (field.id === fieldId || descendantIds.has(field.id)) {
        return {
          ...field,
          row: field.row + deltaRow,
          column: field.column + deltaColumn,
          parentGroupId:
            field.id === fieldId ? nextParentGroupId : field.parentGroupId ?? null,
        };
      }
      return field;
    });
  }

  return fields.map((field) =>
    field.id === fieldId ? { ...field, row, column, parentGroupId: nextParentGroupId } : field,
  );
}

export function resizeField(
  fields: PlacedField[],
  resizeState: ResizeState,
  deltaRows: number,
  deltaColumns: number,
) {
  const targetField = fields.find((field) => field.id === resizeState.fieldId);

  if (!targetField) {
    return fields;
  }

  const nextColSpan =
    resizeState.direction === "columns" || resizeState.direction === "both"
      ? clamp(
          resizeState.startColSpan + deltaColumns,
          1,
          COLUMN_COUNT - targetField.column,
        )
      : targetField.colSpan;
  const nextRowSpan =
    resizeState.direction === "rows" || resizeState.direction === "both"
      ? Math.max(1, resizeState.startRowSpan + deltaRows)
      : targetField.rowSpan;

  if (
    targetField.colSpan === nextColSpan &&
    targetField.rowSpan === nextRowSpan
  ) {
    return fields;
  }

  if (
    !canPlaceField(
      fields,
      targetField.id,
      targetField.row,
      targetField.column,
      nextRowSpan,
      nextColSpan,
    )
  ) {
    return fields;
  }

  return fields.map((field) =>
    field.id === targetField.id
      ? { ...field, rowSpan: nextRowSpan, colSpan: nextColSpan }
      : field,
  );
}

export function canPlaceField(
  fields: PlacedField[],
  ignoredFieldId: string | null,
  row: number,
  column: number,
  rowSpan: number,
  colSpan: number,
  parentGroupId: string | null = null,
) {
  if (row < 0 || column < 0 || column + colSpan > COLUMN_COUNT) {
    return false;
  }

  const candidate = { row, column, rowSpan, colSpan };

  if (parentGroupId) {
    const parentGroup = fields.find((field) => field.id === parentGroupId);
    if (
      !parentGroup ||
      row < parentGroup.row ||
      column < parentGroup.column ||
      row + rowSpan > parentGroup.row + parentGroup.rowSpan ||
      column + colSpan > parentGroup.column + parentGroup.colSpan
    ) {
      return false;
    }
  }

  return !fields.some(
      (field) =>
      field.id !== ignoredFieldId &&
      (field.parentGroupId ?? null) === parentGroupId &&
      rectanglesOverlap(candidate, field),
  );
}

export function rectanglesOverlap(
  left: FieldRectangle,
  right: FieldRectangle,
) {
  return (
    left.row < right.row + right.rowSpan &&
    left.row + left.rowSpan > right.row &&
    left.column < right.column + right.colSpan &&
    left.column + left.colSpan > right.column
  );
}

export function getColumnStep(grid: HTMLDivElement) {
  const rect = grid.getBoundingClientRect();

  return (
    (rect.width - GRID_COLUMN_GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT +
    GRID_COLUMN_GAP
  );
}

export function isTopAlignedField(type: DesignerComponentType) {
  return (
    type === "description" ||
    type === "multiLineText" ||
    type === "radio" ||
    type === "checkbox" ||
    type === "attachment" ||
    type === "imageUpload"
  );
}

export function getInitialFieldLayout(type: DesignerComponentType) {
  if (type === "groupContainer") {
    return { rowSpan: 2, colSpan: 2 };
  }

  if (type === "multiLineText") {
    return { rowSpan: 2, colSpan: 1 };
  }

  if (type === "attachment" || type === "imageUpload") {
    return { rowSpan: 2, colSpan: 1 };
  }

  return { rowSpan: 1, colSpan: 1 };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getTopLevelFields(fields: PlacedField[]) {
  return fields.filter((field) => !field.parentGroupId);
}

export function getChildFields(fields: PlacedField[], parentGroupId: string) {
  return fields.filter((field) => field.parentGroupId === parentGroupId);
}

export function collectGroupDescendantIds(fields: PlacedField[], groupId: string) {
  const result = new Set<string>();
  const queue = [groupId];

  while (queue.length > 0) {
    const currentGroupId = queue.shift();
    if (!currentGroupId) {
      continue;
    }

    for (const field of fields) {
      if (field.parentGroupId === currentGroupId && !result.has(field.id)) {
        result.add(field.id);
        if (field.type === "groupContainer") {
          queue.push(field.id);
        }
      }
    }
  }

  return result;
}
