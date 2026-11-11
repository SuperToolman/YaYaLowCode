import { BUILTIN_RECORD_FIELDS, WORKFLOW_BUILTIN_RECORD_FIELDS } from "@/features/form-model/field-metadata";

const systemFieldIds = new Set<string>([
  ...BUILTIN_RECORD_FIELDS.map((field) => field.id),
  ...WORKFLOW_BUILTIN_RECORD_FIELDS.map((field) => field.id),
]);

/** 系统字段可作为来源读取，不能作为字段映射的写入目标。 */
export function mappingTargetFields<T extends { id: string }>(fields: readonly T[]): T[] {
  return fields.filter((field) => !systemFieldIds.has(field.id));
}
