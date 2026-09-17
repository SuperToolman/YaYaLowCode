export {
  getAppFieldOutline,
  listApps,
  listRoles,
  listUsers,
} from "@lib/api-client";

import {
  ensureWorkflowProcessFlow,
  getForm,
  getFormSchema,
  listAutomationFlows,
  listFormVersions,
  restoreFormVersion,
  saveFormSchema,
} from "@lib/api-client";

export { getFormSchema };

import { ApiRequestError, requestApi, type ApiEnvelope } from "@lib/api-request";

export type { ApiFieldOutlineForm, App } from "@lib/api-client";

function unwrap<T>(data: ApiEnvelope<T> | undefined, error: unknown, fallback: string): T {
  if (error || data?.code !== 0 || data.data === null) {
    throw new ApiRequestError(data?.message || fallback, 0, "business", data?.code, { cause: error });
  }
  return data.data;
}

export type DesignerSchemaPayload<TSchema> = {
  latestVersion: number;
  schema: TSchema;
  version: number;
};

export type DesignerVersion = { version: number; createdAt?: string; changeLog?: string };

export function getDesignerApp(appId: string) {
  // GET /api/apps/{appId} is not currently included in the OpenAPI contract.
  return requestApi<{ name?: string }>(`/api/apps/${encodeURIComponent(appId)}`);
}

export async function getDesignerForm(formUuid: string) {
  const { data, error } = await getForm({ path: { formUuid }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<{ formType?: string }> | undefined, error, "无法加载表单");
}

export async function getDesignerSchema<TSchema>(formUuid: string): Promise<DesignerSchemaPayload<TSchema>> {
  const { data, error } = await getFormSchema({ path: { formUuid }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<DesignerSchemaPayload<TSchema>> | undefined, error, "无法加载表单 Schema");
}

export async function listDesignerVersions<TVersion = DesignerVersion>(formUuid: string): Promise<TVersion[]> {
  const { data, error } = await listFormVersions({ path: { formUuid }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<TVersion[]> | undefined, error, "无法加载历史版本");
}

export async function saveDesignerSchema<TSchema>(
  formUuid: string,
  input: { schema: TSchema; change_log: string; base_version: number },
) {
  const { data, error } = await saveFormSchema({
    path: { formUuid },
    body: input,
    responseStyle: "fields",
  });
  const result = unwrap(
    data as ApiEnvelope<{ latestVersion: number; version: number }> | undefined,
    error,
    "保存失败",
  );
  return { ...result, message: data?.message ?? "" };
}

export async function restoreDesignerVersion<TSchema>(formUuid: string, version: number) {
  const { data, error } = await restoreFormVersion({
    path: { formUuid, version },
    body: {},
    responseStyle: "fields",
  });
  return unwrap(data as ApiEnvelope<{ latestVersion: number; schema: TSchema }> | undefined, error, "读取历史版本失败");
}

export async function listProcessAutomations(appId: string) {
  const { data, error } = await listAutomationFlows({ path: { appId }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<{ items?: Array<{ id: string; flowType?: string; triggerFormUuid?: string | null }> }> | undefined, error, "无法加载自动化流程");
}

export async function restoreProcessAutomation(formUuid: string) {
  const { data, error } = await ensureWorkflowProcessFlow({ path: { formUuid }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<{ id: string }> | undefined, error, "恢复流程自动化失败");
}
