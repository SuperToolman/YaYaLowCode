import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";
import { getRecordsPage } from "@/features/records/api";
import type { FormRecord } from "@/features/records/types";

export function buildExcelColumns(fields: RuntimeSchemaField[]) {
  const labelCounts = new Map<string, number>();
  for (const field of fields)
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  return fields.map((field) => ({
    field,
    header:
      (labelCounts.get(field.label) ?? 0) > 1
        ? `${field.label} (${field.id})`
        : field.label,
  }));
}

export type AssociationImportLookup = {
  primaryFieldId: string;
  records: FormRecord[];
};
export function resolveAssociationImportValue(
  cell: unknown,
  lookup?: AssociationImportLookup,
) {
  const text = String(cell ?? "").trim();
  if (!text || !lookup) return text;
  const bracketMatch = text.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const displayValue = (bracketMatch?.[1] ?? text).trim();
  const fallbackId = bracketMatch?.[2]?.trim() ?? text;
  const matched = lookup.records.find(
    (record) =>
      String(record.data[lookup.primaryFieldId] ?? "")
        .trim()
        .toLocaleLowerCase() === displayValue.toLocaleLowerCase(),
  );
  return (
    matched?.id ??
    lookup.records.find((record) => record.id === fallbackId)?.id ??
    fallbackId
  );
}
export function formatAssociationExportValue(
  value: unknown,
  lookup?: AssociationImportLookup,
) {
  const recordId = String(value ?? "").trim();
  if (!recordId || !lookup) return value ?? "";
  const record = lookup.records.find((item) => item.id === recordId);
  const displayValue = String(record?.data[lookup.primaryFieldId] ?? "").trim();
  return record
    ? displayValue
      ? `${displayValue}[${recordId}]`
      : recordId
    : recordId;
}
export async function loadAssociationImportLookup(
  field: RuntimeSchemaField,
): Promise<AssociationImportLookup | null> {
  const associationFormId = field.props?.associationFormId;
  const primaryFieldId = field.props?.associationPrimaryFieldId;
  if (!associationFormId || !primaryFieldId) return null;
  const records: FormRecord[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await getRecordsPage({
      formUuid: associationFormId,
      page,
      pageSize: 100,
      filters: [],
      sorts: [],
      detail: true,
    });
    records.push(...result.items);
    total = result.total;
    page += 1;
  } while (records.length < total);
  return { primaryFieldId, records };
}
