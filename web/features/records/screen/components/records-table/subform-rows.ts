import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";

// Resolve through layout groups as their values live in the containing record.
export function getSubformAncestors(field: RuntimeSchemaField, fields: RuntimeSchemaField[]) {
  const byId = new Map(fields.map((item) => [item.id, item]));
  const ancestors: RuntimeSchemaField[] = [];
  const visited = new Set([field.id]);
  let parentId = field.parentGroupId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.type === "subform") ancestors.unshift(parent);
    parentId = parent.parentGroupId;
  }
  return ancestors;
}

export function getSubformTableFields(visible: RuntimeSchemaField[], fields: RuntimeSchemaField[]) {
  return visible.filter((field) => field.type !== "subform").map((field) => {
    const parents = getSubformAncestors(field, fields);
    return parents.length ? { ...field, label: [...parents.map((parent) => parent.label), field.label].join(".") } : field;
  });
}

export function getSubformInstanceCount(data: Record<string, unknown>, fieldId: string) {
  const value = data[fieldId];
  return Array.isArray(value)
    ? value.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)).length
    : 0;
}

export type SubformDataRow = {
  id: string;
  label: string;
  subformId: string;
  data: Record<string, unknown>;
  children: SubformDataRow[];
};

export function getSubformDataRows(
  parentId: string,
  data: Record<string, unknown>,
  fields: RuntimeSchemaField[],
  parentSubformId?: string,
): SubformDataRow[] {
  return fields.filter((field) => {
    if (field.type !== "subform" || field.props?.isHidden) return false;
    const parents = getSubformAncestors(field, fields);
    if (parents.at(-1)?.id !== parentSubformId) return false;
    return true;
  }).flatMap((field) => {
    const value = data[field.id];
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const rowData = item as Record<string, unknown>;
      const id = JSON.stringify([parentId, field.id, index]);
      return [{ id, label: `${field.label} ${index + 1}`, subformId: field.id, data: rowData,
        children: getSubformDataRows(id, rowData, fields, field.id) }];
    });
  });
}
