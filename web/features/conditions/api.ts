import { getFormSchema, queryFormRecords, listUsers, listOrganizationUnits, evaluateFormConditions } from "@/shared/lib/http";
import { unwrapApiResult } from "@/shared/lib/api-request";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";

const schemaCache = new Map<string, { expires: number; value: Promise<RuntimeFormSchema> }>();
export function loadConditionSchema(formUuid: string): Promise<RuntimeFormSchema> {
  const cached = schemaCache.get(formUuid);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (schemaCache.size >= 100) schemaCache.delete(schemaCache.keys().next().value!);
  const value = fetchConditionSchema(formUuid).catch(error => { schemaCache.delete(formUuid); throw error; });
  schemaCache.set(formUuid, { expires: Date.now() + 15000, value });
  return value;
}
async function fetchConditionSchema(formUuid: string): Promise<RuntimeFormSchema> {
  const { schema } = unwrapApiResult(await getFormSchema({ path: { formUuid }, responseStyle: "fields" }));
  if (!schema || typeof schema !== "object" || !("fields" in schema) || !Array.isArray(schema.fields)) throw new Error("表单字段结构无效");
  return schema as RuntimeFormSchema;
}
export async function loadConditionRecords(formUuid: string, fieldId: string | undefined, search: string, page: number) {
  const result = unwrapApiResult(await queryFormRecords({ path: { formUuid }, body: { page, pageSize: 30, filters: fieldId && search ? [{ fieldId, operator: "contains", value: search }] : [], sorts: [] }, responseStyle: "fields" }));
  return { total: result.total, items: result.items.map(record => ({ id: record.id, data: record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data as Record<string, unknown> : {} })) };
}
export async function loadConditionRecord(formUuid: string, recordUuid: string) {
  const page = unwrapApiResult(await queryFormRecords({ path: { formUuid }, body: { page: 1, pageSize: 1, filters: [{ fieldId: "recordUuid", operator: "eq", value: recordUuid }], sorts: [] }, responseStyle: "fields" }));
  if (!page.items[0]) throw new Error("关联记录不存在");
  return page.items[0];
}
export async function loadConditionMembers() {
  return unwrapApiResult(await listUsers({ responseStyle: "fields" })).map(user => ({ label: user.displayName, value: user.id }));
}
export async function loadConditionDepartments() {
  return unwrapApiResult(await listOrganizationUnits({ responseStyle: "fields" })).map(unit => ({ label: unit.name, value: unit.id }));
}
export async function evaluateConditions(formUuid: string, rules: import("./index").BranchRule[], records: Record<string, unknown>[]): Promise<boolean[]> {
  const matches: boolean[] = [];
  for (let i = 0; i < records.length; i += 200) matches.push(...unwrapApiResult(await evaluateFormConditions({ path: { formUuid }, body: { rules, records: records.slice(i, i + 200) }, responseStyle: "fields" })));
  return matches;
}
