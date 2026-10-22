import type { FieldMappingRow, FormFieldDescriptor } from "./types";

export function createFieldMappingRow(fieldId: string): FieldMappingRow {
  return { id: `row-${fieldId}-${Date.now()}`, fieldId, valueType: "value", rawValue: "", sourceFieldKey: "", formula: "" };
}

export function normalizeFieldMappingRow(value: unknown): FieldMappingRow | null {
  if (!value || typeof value !== "object") return null;
  const current = value as Record<string, unknown>;
  const fieldId = typeof current.fieldId === "string" ? current.fieldId : "";
  if (!fieldId) return null;
  return {
    id: typeof current.id === "string" && current.id ? current.id : `row-${fieldId}-${Date.now()}`,
    fieldId,
    valueType: current.valueType === "field" || current.valueType === "formula" ? current.valueType : "value",
    rawValue: typeof current.rawValue === "string" ? current.rawValue : "",
    sourceFieldKey: typeof current.sourceFieldKey === "string" ? current.sourceFieldKey : "",
    formula: typeof current.formula === "string" ? current.formula : "",
  };
}

export function syncRequiredRows(rows: FieldMappingRow[], fields: FormFieldDescriptor[]) {
  const next = [...rows];
  for (const field of fields.filter((item) => item.isRequired)) {
    if (!next.some((row) => row.fieldId === field.id)) next.push(createFieldMappingRow(field.id));
  }
  return next;
}
