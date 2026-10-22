import type { FieldMappingRow } from "./types";
import { createFieldMappingRow } from "./model";

export function addMappingRow(rows: FieldMappingRow[], fieldId = ""): FieldMappingRow[] {
  return [...rows, createFieldMappingRow(fieldId)];
}

export function removeMappingRow(rows: FieldMappingRow[], rowId: string): FieldMappingRow[] {
  return rows.filter((row) => row.id !== rowId);
}

export function updateMappingRow(
  rows: FieldMappingRow[],
  rowId: string,
  key: keyof FieldMappingRow,
  value: string,
): FieldMappingRow[] {
  if (key === "fieldId" && value && rows.some((row) => row.id !== rowId && row.fieldId === value)) return rows;
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    const next = { ...row, [key]: value } as FieldMappingRow;
    if (key === "fieldId" || key === "valueType") {
      next.rawValue = "";
      next.sourceFieldKey = "";
      next.formula = "";
      if (key === "fieldId") next.valueType = "value";
    }
    return next;
  });
}
