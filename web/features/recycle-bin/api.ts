import {
  deleteRecycleBinEntry,
  emptyRecycleBin,
  getRecycleBinSettings,
  listRecycleBin,
  restoreRecycleBinEntry,
  updateRecycleBinSettings,
} from "@lib/api-client";
import { ApiRequestError, type ApiEnvelope } from "@lib/api-request";
import type { RecycleBinEntry, RecycleBinSettings } from "@lib/api-client";

function unwrap<T>(data: ApiEnvelope<T> | undefined, error: unknown, fallback: string): T {
  if (error || data?.code !== 0 || data.data === null) {
    throw new ApiRequestError(data?.message || fallback, 0, "business", data?.code, { cause: error });
  }
  return data.data;
}

export async function listRecycleBinEntries(formUuid?: string): Promise<RecycleBinEntry[]> {
  const { data, error } = await listRecycleBin({ query: formUuid ? { formUuid } : undefined, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<RecycleBinEntry[]> | undefined, error, "无法加载回收站");
}

export async function restoreRecycleBinItem(id: string) {
  const { data, error } = await restoreRecycleBinEntry({ path: { id }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<unknown> | undefined, error, "恢复失败");
}

export async function deleteRecycleBinItem(id: string) {
  const { data, error } = await deleteRecycleBinEntry({ path: { id }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<unknown> | undefined, error, "永久删除失败");
}

export async function emptyRecycleBinItems() {
  const { data, error } = await emptyRecycleBin({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<unknown> | undefined, error, "清空失败");
}

export async function loadRecycleBinSettings(): Promise<RecycleBinSettings> {
  const { data, error } = await getRecycleBinSettings({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<RecycleBinSettings> | undefined, error, "无法加载回收站设置");
}

export async function saveRecycleBinSettings(retentionDays: number): Promise<RecycleBinSettings> {
  const { data, error } = await updateRecycleBinSettings({ body: { retentionDays }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<RecycleBinSettings> | undefined, error, "无法保存回收站设置");
}
