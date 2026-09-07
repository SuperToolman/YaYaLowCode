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
} from "@/app/lib/api-client";
import type { ApiEnvelope } from "@/app/lib/api-request";
import { ApiRequestError } from "@/app/lib/api-request";
import type { DetailForm, FormRecord, RecordFilter, RecordsPage, RecordSort, WorkflowAction, WorkflowComment } from "./types";

function unwrap<T>(data: ApiEnvelope<T> | undefined, error: unknown, fallback: string): T {
  if (error || data?.code !== 0 || !data.data) {
    throw new ApiRequestError(data?.message || fallback, 0, "business", data?.code, { cause: error });
  }
  return data.data;
}

export async function getDetailForms(formUuid: string) {
  const { data, error } = await listDetailForms({ path: { formUuid }, responseStyle: "fields" });
  return unwrap(data as unknown as ApiEnvelope<DetailForm[]> | undefined, error, "无法加载明细表单");
}

export async function createRecord(formUuid: string, values: Record<string, unknown>) {
  const { data, error } = await createFormRecord({ path: { formUuid }, body: { data: values }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<FormRecord> | undefined, error, "提交失败");
}

export async function updateRecord(formUuid: string, recordUuid: string, values: Record<string, unknown>) {
  const { data, error } = await updateFormRecord({ path: { formUuid, recordUuid }, body: { data: values }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<FormRecord> | undefined, error, "更新失败");
}

export async function deleteRecord(formUuid: string, recordUuid: string) {
  const { data, error } = await deleteFormRecord({ path: { formUuid, recordUuid }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<unknown> | undefined, error, "删除记录失败");
}

export async function deleteFormData(formUuid: string) {
  const { data, error } = await deleteForm({ path: { formUuid }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<unknown> | undefined, error, "删除表单失败");
}

export async function createDetailFormData(formUuid: string, body: {
  subformFieldId: string;
  primaryDisplayFieldId?: string;
  secondaryDisplayFieldId?: string;
}) {
  const { data, error } = await createDetailForm({ path: { formUuid }, body, responseStyle: "fields" });
  return unwrap(data as unknown as ApiEnvelope<DetailForm> | undefined, error, "创建明细表单失败");
}

export async function getFormBootstrapData(appId: string, formUuid: string) {
  const { data, error } = await getFormBootstrap({
    path: { formUuid },
    query: { appId, page: 1, pageSize: 20 },
    responseStyle: "fields",
  });
  return unwrap(data as unknown as ApiEnvelope<NonNullable<typeof data>["data"]> | undefined, error, "无法加载表单启动数据");
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
  return unwrap(result.data as ApiEnvelope<RecordsPage> | undefined, result.error, "无法加载表单记录");
}

export async function getAssociationFormData(formUuid: string) {
  const [schemaResult, recordsResult] = await Promise.all([
    getFormSchema({ path: { formUuid }, responseStyle: "fields" }),
    listFormRecords({ path: { formUuid }, query: { page: 1, pageSize: 100 }, responseStyle: "fields" }),
  ]);
  const schema = schemaResult.data?.code === 0 ? schemaResult.data.data?.schema : null;
  const records = recordsResult.data?.code === 0 ? recordsResult.data.data?.items : null;
  if (schemaResult.error || recordsResult.error || !schema || !records) {
    throw new ApiRequestError("无法加载关联表单数据", 0, "business", undefined, { cause: schemaResult.error ?? recordsResult.error });
  }
  return { schema, records: new Map((records as FormRecord[]).map((record) => [record.id, record])) };
}

export async function getWorkflowActions(formUuid: string, recordUuid: string, signal?: AbortSignal) {
  const { data, error } = await getWorkflowRecordRuntime({ path: { formUuid, recordUuid }, signal, responseStyle: "fields" });
  const result = unwrap(data as ApiEnvelope<{ actions?: WorkflowAction[] }> | undefined, error, "加载流程轨迹失败");
  return result.actions ?? [];
}

export async function getWorkflowComments(formUuid: string, recordUuid: string, signal?: AbortSignal) {
  const { data, error } = await listWorkflowComments({ path: { formUuid, recordUuid }, signal, responseStyle: "fields" });
  const result = unwrap(data as ApiEnvelope<{ items?: WorkflowComment[] }> | undefined, error, "加载评论失败");
  return result.items ?? [];
}

export async function postWorkflowComment(formUuid: string, recordUuid: string, content: string) {
  const { data, error } = await createWorkflowComment({ path: { formUuid, recordUuid }, body: { content }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<WorkflowComment> | undefined, error, "评论发布失败");
}
