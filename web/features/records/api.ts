import {
  createWorkflowComment,
  createDetailForm,
  createFormRecord,
  deleteForm,
  deleteFormRecord,
  getFormBootstrap,
  getFormSchema,
  getWorkflowRecordRuntime,
  listFormRecords,
  listDetailForms,
  listWorkflowComments,
  queryFormRecords,
  updateFormRecord,
} from "@/app/lib/http";
import { unwrapApiResult } from "@/app/lib/api-request";
import type { FormRecord, RecordFilter, RecordsPage, RecordSort } from "./types";


export async function getDetailForms(formUuid: string) {
  const { data, error, response } = await listDetailForms({ path: { formUuid }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法加载明细表单");
}

export async function createRecord(formUuid: string, values: Record<string, unknown>) {
  const { data, error, response } = await createFormRecord({ path: { formUuid }, body: { data: values }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "提交失败");
}

export async function updateRecord(formUuid: string, recordUuid: string, values: Record<string, unknown>) {
  const { data, error, response } = await updateFormRecord({ path: { formUuid, recordUuid }, body: { data: values }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "更新失败");
}

export async function deleteRecord(formUuid: string, recordUuid: string) {
  const { data, error, response } = await deleteFormRecord({ path: { formUuid, recordUuid }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "删除记录失败");
}

export async function deleteFormData(formUuid: string) {
  const { data, error, response } = await deleteForm({ path: { formUuid }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "删除表单失败");
}

export async function createDetailFormData(formUuid: string, body: {
  subformFieldId: string;
  primaryDisplayFieldId?: string;
  secondaryDisplayFieldId?: string;
}) {
  const { data, error, response } = await createDetailForm({ path: { formUuid }, body, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "创建明细表单失败");
}

export async function getFormBootstrapData(appId: string, formUuid: string) {
  const { data, error, response } = await getFormBootstrap({
    path: { formUuid },
    query: { appId, page: 1, pageSize: 20 },
    responseStyle: "fields",
  });
  return unwrapApiResult({ data, error, response }, "无法加载表单启动数据");
}

export async function getRecordsPage(input: {
  formUuid: string;
  page: number;
  pageSize: number;
  filters: RecordFilter[];
  sorts: RecordSort[];
  detail: boolean;
}): Promise<RecordsPage> {
  const result = input.detail
    ? await listFormRecords({
        path: { formUuid: input.formUuid },
        query: { page: input.page, pageSize: input.pageSize },
        responseStyle: "fields",
      })
    : await queryFormRecords({
        path: { formUuid: input.formUuid },
        body: { page: input.page, pageSize: input.pageSize, filters: input.filters, sorts: input.sorts },
        responseStyle: "fields",
      });
  const page = unwrapApiResult(result, "无法加载表单记录");
  return { ...page, items: page.items.map(toRecord) };
}

export async function getAssociationFormData(formUuid: string) {
  const [schemaResult, recordsResult] = await Promise.all([
    getFormSchema({ path: { formUuid }, responseStyle: "fields" }),
    listFormRecords({ path: { formUuid }, query: { page: 1, pageSize: 100 }, responseStyle: "fields" }),
  ]);
  const { schema } = unwrapApiResult(schemaResult);
  const { items } = unwrapApiResult(recordsResult);
  return { schema, records: new Map(items.map((record) => [record.id, toRecord(record)])) };
}

export async function getWorkflowActions(formUuid: string, recordUuid: string, signal?: AbortSignal) {
  const { data, error, response } = await getWorkflowRecordRuntime({ path: { formUuid, recordUuid }, signal, responseStyle: "fields" });
  const result = unwrapApiResult({ data, error, response }, "加载流程轨迹失败");
  return result.actions ?? [];
}

export async function getWorkflowComments(formUuid: string, recordUuid: string, signal?: AbortSignal) {
  const { data, error, response } = await listWorkflowComments({ path: { formUuid, recordUuid }, signal, responseStyle: "fields" });
  const result = unwrapApiResult({ data, error, response }, "加载评论失败");
  return result.items ?? [];
}

export async function postWorkflowComment(formUuid: string, recordUuid: string, content: string) {
  const { data, error, response } = await createWorkflowComment({ path: { formUuid, recordUuid }, body: { content }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "评论发布失败");
}

function toRecord(record: import("@lib/http").ApiFormRecord): FormRecord {
  const data = record.data;
  return { ...record, data: typeof data === "object" && data !== null && !Array.isArray(data) ? Object.fromEntries(Object.entries(data)) : {} };
}
