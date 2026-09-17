import {
  cleanupCommunicationData,
  getCommunicationModuleSettings,
  getCommunicationStorageStats,
  updateCommunicationModuleSettings,
  getDatabaseSettings,
  updateDatabaseSettings,
  testDatabaseConnection,
  getValkeySettings,
  updateValkeySettings,
  testValkeyConnection,
  getPlatformLicenseStatus,
  activatePlatformLicense,
  applyLatestPlatformLicense,
  clearDingTalkData,
  getIdentitySourceSettings,
  refreshDingTalkAccessToken,
  syncDingTalkDepartments,
  syncDingTalkUsers,
  updateIdentitySourceSettings,
  getAiEmployeeMarket,
  installAiEmployee,
  testPurchaseAiEmployee,
} from "@lib/api-client";
import { ApiRequestError, jsonRequest, requestApi, type ApiEnvelope } from "@lib/api-request";

function unwrap<T>(data: ApiEnvelope<T> | undefined, error: unknown, fallback: string): T {
  if (error || data?.code !== 0 || data.data === null) {
    throw new ApiRequestError(data?.message || fallback, 0, "business", data?.code, { cause: error });
  }
  return data.data;
}

export async function getCommunicationSettings<T>() {
  const { data, error } = await getCommunicationModuleSettings({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法加载通讯模块状态");
}

export async function getCommunicationStats<T>() {
  const { data, error } = await getCommunicationStorageStats({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法加载存储统计");
}

export async function updateCommunicationSettings<T>(settings: T) {
  const { data, error } = await updateCommunicationModuleSettings({ body: settings as never, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "保存通讯模块设置失败");
}

export async function cleanupCommunication<T>() {
  const { data, error } = await cleanupCommunicationData({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "清理失败");
}

export async function loadDatabaseSettings<T>() {
  const { data, error } = await getDatabaseSettings({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法加载数据库配置");
}
export async function saveDatabaseSettings<T>(body: { host: string; port: number; database: string; username: string; password: string }) {
  const { data, error } = await updateDatabaseSettings({ body, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "保存数据库配置失败");
}
export async function testDatabase<T>(body: { host: string; port: number; database: string; username: string; password: string }) {
  const { data, error } = await testDatabaseConnection({ body, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "数据库连接测试失败");
}
export async function loadValkeySettings<T>() {
  const { data, error } = await getValkeySettings({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法加载 Valkey 配置");
}
export async function saveValkeySettings<T>(body: { enabled: boolean; host: string; port: number; database: number; username: string; password: string; cacheTtlHours: number }) {
  const { data, error } = await updateValkeySettings({ body, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "保存 Valkey 配置失败");
}
export async function testValkey<T>(body: { enabled: boolean; host: string; port: number; database: number; username: string; password: string; cacheTtlHours: number }) {
  const { data, error } = await testValkeyConnection({ body, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "Valkey 连接测试失败");
}

export async function getLicenseStatus<T>() {
  const { data, error } = await getPlatformLicenseStatus({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法读取许可证状态");
}

export async function activateLicense<T>(body: { licenseCenterUrl: string; license: string }) {
  const { data, error } = await activatePlatformLicense({ body, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法更新许可证");
}

export async function applyLatestLicense<T>() {
  const { data, error } = await applyLatestPlatformLicense({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法更新平台签名");
}

export async function getIdentitySettings<T>() {
  const { data, error } = await getIdentitySourceSettings({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法加载身份源配置");
}

export async function saveIdentitySettings<T>(body: T) {
  const { data, error } = await updateIdentitySourceSettings({ body: body as never, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "保存身份源配置失败");
}

export async function refreshDingTalkToken<T>() {
  const { data, error } = await refreshDingTalkAccessToken({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "获取 AccessToken 失败");
}

export async function synchronizeDingTalkDepartments<T>() {
  const { data, error } = await syncDingTalkDepartments({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "同步钉钉组织架构失败");
}

export async function synchronizeDingTalkUsers<T>() {
  const { data, error } = await syncDingTalkUsers({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "同步钉钉用户失败");
}

export async function clearDingTalkIdentityData<T>() {
  const { data, error } = await clearDingTalkData({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "清除钉钉数据失败");
}

export async function getAiEmployees<T>() {
  const { data, error } = await getAiEmployeeMarket({ responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "无法读取 AI 员工市场");
}

export async function installMarketAiEmployee<T>(employeeId: string) {
  const { data, error } = await installAiEmployee({ path: { employee_id: employeeId }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "安装 AI 员工失败");
}

// The uninstall operation exists in the Next API but is not yet described by OpenAPI.
export function uninstallMarketAiEmployee<T>(employeeId: string) {
  return requestApi<T>(`/api/settings/ai-employee-market/${encodeURIComponent(employeeId)}/uninstall`, { method: "POST" });
}

export async function testMarketAiEmployeePurchase<T>(employeeId: string) {
  const { data, error } = await testPurchaseAiEmployee({ path: { employee_id: employeeId }, responseStyle: "fields" });
  return unwrap(data as ApiEnvelope<T> | undefined, error, "测试支付失败");
}

// Model routes are a settings-specific resource and are not the OpenAPI agent-provider API.
export function listModelRoutes<T>() {
  return requestApi<T>("/api/settings/model-routes", { cache: "no-store" });
}

export function createModelRoute<T>(body: unknown) {
  return requestApi<T>("/api/settings/model-routes", jsonRequest(body, { method: "POST" }));
}

export function updateModelRoute<T>(id: string, body: unknown) {
  return requestApi<T>(`/api/settings/model-routes/${encodeURIComponent(id)}`, jsonRequest(body, { method: "PUT" }));
}

export function deleteModelRoute<T>(id: string) {
  return requestApi<T>(`/api/settings/model-routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listPlatformLogs<T>(params: { limit: number; offset: number; level?: string }) {
  const search = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
  if (params.level) search.set("level", params.level);
  return requestApi<T>(`/api/settings/logs?${search}`, { cache: "no-store" });
}

export function clearPlatformLogs<T>() {
  return requestApi<T>("/api/settings/logs", { method: "DELETE" });
}
