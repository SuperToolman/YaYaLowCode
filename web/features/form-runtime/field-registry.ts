import type { RuntimeSchemaField } from "./types";

export type RuntimeFieldKind = RuntimeSchemaField["type"];

const NON_DATA_FIELDS = new Set<RuntimeFieldKind>([
  "description",
  "groupContainer",
  "button",
  "link",
  "html",
  "tsx",
]);

export function isRuntimeDataField(field: RuntimeSchemaField) {
  return !NON_DATA_FIELDS.has(field.type);
}

export function isRuntimeContainerField(field: RuntimeSchemaField) {
  return field.type === "groupContainer" || field.type === "subform";
}
