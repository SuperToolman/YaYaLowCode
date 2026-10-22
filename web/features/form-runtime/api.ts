import { getFormSchema, listFormRecords, listRoles, listUsers, validateFormRecord } from "@/app/lib/http";
import { ApiRequestError, unwrapApiResult } from "@/app/lib/api-request";
import type { AssociationRecord, RuntimeFormSchema, RuntimeIdentityCatalog } from "./types";

export async function fetchCurrentFormSchema(formUuid: string): Promise<RuntimeFormSchema> {
  const result = await getFormSchema({
    path: { formUuid },
    responseStyle: "fields",
  });
  const { schema } = unwrapApiResult(result, "无法加载表单 Schema");
  if (!schema || typeof schema !== "object" || !("fields" in schema) || !Array.isArray(schema.fields)) throw new ApiRequestError("表单 Schema 格式无效", result.response?.status ?? 200, "invalid-response");
  return schema as RuntimeFormSchema;
}

export async function fetchAssociationRecords(formUuid: string, signal?: AbortSignal): Promise<AssociationRecord[]> {
  const result = await listFormRecords({
    path: { formUuid },
    query: { page: 1, pageSize: 100 },
    responseStyle: "fields",
    signal,
  });
  const page = unwrapApiResult(result, "无法加载关联记录");
  return page.items.map((record) => ({
    id: record.id,
    data: isRecordData(record.data) ? record.data : {},
  }));
}

export async function fetchRuntimeIdentityCatalog(signal?: AbortSignal): Promise<RuntimeIdentityCatalog> {
  const [usersResult, rolesResult] = await Promise.all([
    listUsers({ responseStyle: "fields", signal }),
    listRoles({ responseStyle: "fields", signal }),
  ]);
  const users = unwrapApiResult(usersResult, "无法加载成员目录");
  const roles = unwrapApiResult(rolesResult, "无法加载成员目录");
  return {
    users: users.map((user) => ({
      avatarUrl: user.avatarUrl ?? null,
      displayName: user.displayName,
      id: user.id,
      jobNumber: user.jobNumber ?? null,
      roles: user.roles,
      sourceType: user.sourceType,
      status: user.status,
    })),
    roles,
  };
}

function isRecordData(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export {
  createFormView,
  deleteFormView,
  getForm,
  getFormSchema,
  listFormViews,
  updateFormView,
} from "@/app/lib/http";

export async function validateFormSubmission(schema: RuntimeFormSchema, values: Record<string, unknown>, recordUuid?: string) {
  const result = await validateFormRecord({
    path: { formUuid: schema.formUuid },
    body: { data: values, recordUuid, schema },
    responseStyle: "fields",
  });
  return unwrapApiResult(result, "无法完成提交校验");
}
