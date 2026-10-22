import {
  deleteRecycleBinEntry,
  emptyRecycleBin,
  getRecycleBinSettings,
  listRecycleBin,
  restoreRecycleBinEntry,
  updateRecycleBinSettings,
} from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";
import type { RecycleBinEntry, RecycleBinSettings } from "@lib/http";


export async function listRecycleBinEntries(formUuid?: string): Promise<RecycleBinEntry[]> {
  const { data, error, response } = await listRecycleBin({ query: formUuid ? { formUuid } : undefined, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法加载回收站");
}

export async function restoreRecycleBinItem(id: string) {
  const { data, error, response } = await restoreRecycleBinEntry({ path: { id }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "恢复失败");
}

export async function deleteRecycleBinItem(id: string) {
  const { data, error, response } = await deleteRecycleBinEntry({ path: { id }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "永久删除失败");
}

export async function emptyRecycleBinItems() {
  const { data, error, response } = await emptyRecycleBin({ responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "清空失败");
}

export async function loadRecycleBinSettings(): Promise<RecycleBinSettings> {
  const { data, error, response } = await getRecycleBinSettings({ responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法加载回收站设置");
}

export async function saveRecycleBinSettings(retentionDays: number): Promise<RecycleBinSettings> {
  const { data, error, response } = await updateRecycleBinSettings({ body: { retentionDays }, responseStyle: "fields" });
  return unwrapApiResult({ data, error, response }, "无法保存回收站设置");
}
