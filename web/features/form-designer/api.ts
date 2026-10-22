export {
  getAppFieldOutline,
  listApps,
  listRoles,
  listUsers,
} from "@lib/http";

import {
  getApp,
  ensureWorkflowProcessFlow,
  getForm,
  getFormSchema,
  listAutomationFlows,
  listFormVersions,
  restoreFormVersion,
  saveFormSchema,
} from "@lib/http";

export { getFormSchema };

import { unwrapApiResult } from "@lib/api-request";

export type { ApiFieldOutlineForm, App } from "@lib/http";


export type DesignerSchemaPayload<TSchema> = {
  latestVersion: number;
  schema: TSchema;
  version: number;
};

export type DesignerVersion = { version: number; componentCount?: number; createdAt?: string; changeLog?: string };

export function getDesignerApp(appId: string) {
  return getApp({ path: { appId } }).then(result => unwrapApiResult(result));
}

export async function getDesignerForm(formUuid: string) {
  const { data, error, response } = await getForm({ path: { formUuid }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法加载表单");
}

export async function getDesignerSchema<TSchema>(formUuid: string, decode: (schema: unknown) => TSchema) {
  const { data, error, response } = await getFormSchema({ path: { formUuid }, responseStyle: "fields" });
  const payload = unwrapApiResult({ data, error, response }, "无法加载表单 Schema");
  return { ...payload, schema: decode(payload.schema) };
}

export async function listDesignerVersions(formUuid: string) {
  const { data, error, response } = await listFormVersions({ path: { formUuid }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法加载历史版本");
}

export async function saveDesignerSchema<TSchema>(
  formUuid: string,
  input: { schema: TSchema; change_log: string; base_version: number },
) {
  const { data, error, response } = await saveFormSchema({
    path: { formUuid },
    body: input,
    responseStyle: "fields",
  });
  const result = unwrapApiResult(
    { data, error, response },
    "保存失败",
  );
  return { ...result, message: data?.message ?? "" };
}

export async function restoreDesignerVersion<TSchema>(formUuid: string, version: number, decode: (schema: unknown) => TSchema) {
  const { data, error, response } = await restoreFormVersion({
    path: { formUuid, version },
    body: {},
    responseStyle: "fields",
  });
  const payload = unwrapApiResult({ data, error, response }, "读取历史版本失败");
  return { ...payload, schema: decode(payload.schema) };
}

export async function listProcessAutomations(appId: string) {
  const { data, error, response } = await listAutomationFlows({ path: { appId }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法加载自动化流程");
}

export async function restoreProcessAutomation(formUuid: string) {
  const { data, error, response } = await ensureWorkflowProcessFlow({ path: { formUuid }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "恢复流程自动化失败");
}
