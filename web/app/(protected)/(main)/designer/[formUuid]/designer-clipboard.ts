import { COLUMN_COUNT } from "./designer-constants";
import { expandGroupToFit, rectanglesOverlap } from "./designer-layout";
import type { PlacedField } from "./designer-types";

/** Finds the first free rectangle in the field's own canvas or container. */
export function placePastedFields(fields: PlacedField[], copies: PlacedField[]): PlacedField[] | null {
  const root = copies[0];
  if (!root) return null;
  const parent = root.parentGroupId ? fields.find((field) => field.id === root.parentGroupId) : null;
  if (root.parentGroupId && !parent) return null;
  const isSubform = parent?.type === "subform";
  const columnStart = parent?.type === "groupContainer" ? parent.column : 0;
  const columnEnd = parent?.type === "groupContainer" ? parent.column + parent.colSpan : COLUMN_COUNT;
  const rowStart = parent?.row ?? 0;
  const siblings = fields.filter((field) => (field.parentGroupId ?? null) === (root.parentGroupId ?? null));
  const colSpan = isSubform ? 1 : root.colSpan;
  const rowSpan = isSubform ? 1 : root.rowSpan;
  if (colSpan > columnEnd - columnStart) return null;
  const lastRow = Math.max(rowStart, ...siblings.map((field) => field.row + field.rowSpan));
  for (let row = rowStart; row <= lastRow; row++) {
    const columns = Array.from(
      { length: columnEnd - columnStart - colSpan + 1 },
      (_, index) => columnStart + index,
    ).sort((left, right) =>
      Math.abs(left - root.column) - Math.abs(right - root.column) || left - right,
    );
    for (const column of columns) {
      const rectangle = { row, column, rowSpan, colSpan };
      if (siblings.some((field) => rectanglesOverlap(rectangle, field))) continue;
      const deltaRow = row - root.row;
      const deltaColumn = column - root.column;
      const translated = copies.map((field) => {
        const copiedParent = copies.find((candidate) => candidate.id === field.parentGroupId);
        return {
          ...field,
          row: field.row + deltaRow,
          // Subform columns are local to the table; group columns use canvas coordinates.
          column: copiedParent?.type === "subform" ? field.column : field.column + deltaColumn,
          ...(field.id === root.id ? { rowSpan, colSpan } : {}),
        };
      });
      return expandGroupToFit([...fields, ...translated], root.parentGroupId ?? null, row + rowSpan);
    }
  }
  return null;
}

/** Recovers subform fields hidden by historical paste row/column coordinates. */
export function normalizeSubformChildLayouts(fields: PlacedField[]): PlacedField[] {
  let result = fields;
  for (const parent of fields.filter((field) => field.type === "subform")) {
    const children = fields
      .filter((field) => field.parentGroupId === parent.id)
      .sort((left, right) => left.row - right.row || left.column - right.column);
    const occupied: PlacedField[] = [];
    const positions = new Map<string, PlacedField>();
    const maxRow = parent.row + Math.floor(Math.max(0, children.length - 1) / COLUMN_COUNT);
    for (const child of children) {
      let row = Math.max(parent.row, child.row);
      let column = child.column;
      if (row > maxRow || column < 0 || column >= COLUMN_COUNT || occupied.some((field) => field.row === row && field.column === column)) {
        row = parent.row;
        column = 0;
        while (occupied.some((field) => field.row === row && field.column === column)) {
          column++;
          if (column === COLUMN_COUNT) { column = 0; row++; }
        }
      }
      const normalized = { ...child, row, column, rowSpan: 1, colSpan: 1 };
      occupied.push(normalized);
      positions.set(child.id, normalized);
    }
    result = result.map((field) => positions.get(field.id) ?? field);
  }
  return result;
}
