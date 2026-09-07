import { getFormSchema, listFormRecords, listRoles, listUsers } from "@/app/lib/api-client";
import { ApiRequestError } from "@/app/lib/api-request";
import type { AssociationRecord, RuntimeFormSchema, RuntimeIdentityCatalog } from "./types";

export async function fetchCurrentFormSchema(formUuid: string): Promise<RuntimeFormSchema> {
  const { data, error } = await getFormSchema({
    path: { formUuid },
    responseStyle: "fields",
  });
  if (error || data?.code !== 0 || !data.data?.schema) {
    throw new ApiRequestError(data?.message || "无法加载表单 Schema", 0, "business", data?.code, { cause: error });
  }
  return data.data.schema as RuntimeFormSchema;
}

export async function fetchAssociationRecords(formUuid: string, signal?: AbortSignal): Promise<AssociationRecord[]> {
  const { data, error } = await listFormRecords({
    path: { formUuid },
    query: { page: 1, pageSize: 100 },
    responseStyle: "fields",
    signal,
  });
  if (error || data?.code !== 0 || !data.data) {
    throw new ApiRequestError(data?.message || "无法加载关联记录", 0, "business", data?.code, { cause: error });
  }
  return data.data.items.map((record) => ({
    id: record.id,
    data: isRecordData(record.data) ? record.data : {},
  }));
}

export async function fetchRuntimeIdentityCatalog(signal?: AbortSignal): Promise<RuntimeIdentityCatalog> {
  const [usersResult, rolesResult] = await Promise.all([
    listUsers({ responseStyle: "fields", signal }),
    listRoles({ responseStyle: "fields", signal }),
  ]);
  const usersData = usersResult.data;
  const rolesData = rolesResult.data;
  if (usersResult.error || usersData?.code !== 0 || !usersData.data || rolesResult.error || rolesData?.code !== 0 || !rolesData.data) {
    throw new ApiRequestError("无法加载成员目录", 0, "business", undefined, { cause: usersResult.error ?? rolesResult.error });
  }
  return {
    users: usersData.data.map((user) => ({
      avatarUrl: user.avatarUrl ?? null,
      displayName: user.displayName,
      id: user.id,
      jobNumber: user.jobNumber ?? null,
      roles: user.roles,
      sourceType: user.sourceType,
      status: user.status,
    })),
    roles: rolesData.data,
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
} from "@/app/lib/api-client";
