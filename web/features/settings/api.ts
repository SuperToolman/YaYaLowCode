import * as sdk from "@lib/http";
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
} from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";

export async function getCommunicationSettings() {
  const result = await getCommunicationModuleSettings({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法加载通讯模块状态");
}

export async function getCommunicationStats() {
  const result = await getCommunicationStorageStats({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法加载存储统计");
}

export async function updateCommunicationSettings(settings: import("@lib/http").CommunicationModuleSettings) {
  const result = await updateCommunicationModuleSettings({ body: settings, responseStyle: "fields" });
  return unwrapApiResult(result, "保存通讯模块设置失败");
}

export async function cleanupCommunication() {
  const result = await cleanupCommunicationData({ responseStyle: "fields" });
  return unwrapApiResult(result, "清理失败");
}

export async function loadDatabaseSettings() {
  const result = await getDatabaseSettings({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法加载数据库配置");
}
export async function saveDatabaseSettings(body: sdk.UpdateDatabaseSettingsRequest) {
  const result = await updateDatabaseSettings({ body, responseStyle: "fields" });
  return unwrapApiResult(result, "保存数据库配置失败");
}
export async function testDatabase(body: sdk.TestDatabaseConnectionData["body"]) {
  const result = await testDatabaseConnection({ body, responseStyle: "fields" });
  return unwrapApiResult(result, "数据库连接测试失败");
}
export async function loadValkeySettings() {
  const result = await getValkeySettings({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法加载 Valkey 配置");
}
export type ValkeyRuntimeStatus = sdk.ValkeyRuntimeStatusResponse;
export async function getValkeyRuntimeStatus(signal?: AbortSignal) { return unwrapApiResult(await sdk.getValkeyRuntimeStatus({ signal, cache: "no-store" })); }
export async function saveValkeySettings(body: sdk.UpdateValkeySettingsRequest) {
  const result = await updateValkeySettings({ body, responseStyle: "fields" });
  return unwrapApiResult(result, "保存 Valkey 配置失败");
}
export async function testValkey(body: sdk.TestValkeyConnectionData["body"]) {
  const result = await testValkeyConnection({ body, responseStyle: "fields" });
  return unwrapApiResult(result, "Valkey 连接测试失败");
}

export async function getLicenseStatus() {
  const result = await getPlatformLicenseStatus({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法读取许可证状态");
}

export async function activateLicense(body: sdk.ActivatePlatformLicenseRequest) {
  const result = await activatePlatformLicense({ body, responseStyle: "fields" });
  return unwrapApiResult(result, "无法更新许可证");
}

export async function applyLatestLicense() {
  const result = await applyLatestPlatformLicense({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法更新平台签名");
}

export async function getIdentitySettings() {
  const result = await getIdentitySourceSettings({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法加载身份源配置");
}

export async function saveIdentitySettings(body: import("@lib/http").UpdateIdentitySourceSettingsRequest) {
  const result = await updateIdentitySourceSettings({ body: body, responseStyle: "fields" });
  return unwrapApiResult(result, "保存身份源配置失败");
}

export async function refreshDingTalkToken() {
  const result = await refreshDingTalkAccessToken({ responseStyle: "fields" });
  return unwrapApiResult(result, "获取 AccessToken 失败");
}

export async function synchronizeDingTalkDepartments() {
  const result = await syncDingTalkDepartments({ responseStyle: "fields" });
  return unwrapApiResult(result, "同步钉钉组织架构失败");
}

export async function synchronizeDingTalkUsers() {
  const result = await syncDingTalkUsers({ responseStyle: "fields" });
  return unwrapApiResult(result, "同步钉钉用户失败");
}

export async function clearDingTalkIdentityData() {
  const result = await clearDingTalkData({ responseStyle: "fields" });
  return unwrapApiResult(result, "清除钉钉数据失败");
}

export async function getAiEmployees() {
  const result = await getAiEmployeeMarket({ responseStyle: "fields" });
  return unwrapApiResult(result, "无法读取 AI 员工市场");
}

export async function installMarketAiEmployee(employeeId: string) {
  const result = await installAiEmployee({ path: { employee_id: employeeId }, responseStyle: "fields" });
  return unwrapApiResult(result, "安装 AI 员工失败");
}

export async function uninstallMarketAiEmployee(employeeId: string) {
  return unwrapApiResult(await sdk.uninstallAiEmployee({ path: { employee_id: employeeId } }));
}
export async function testMarketAiEmployeePurchase(employeeId: string) {
  return unwrapApiResult(await sdk.testPurchaseAiEmployee({ path: { employee_id: employeeId } }));
}
export async function listModelRoutes() { return unwrapApiResult(await sdk.listModelRoutes()); }
export async function createModelRoute(body: sdk.ModelRouteRequest) { return unwrapApiResult(await sdk.createModelRoute({ body })); }
export async function updateModelRoute(id: string, body: sdk.ModelRouteRequest) { return unwrapApiResult(await sdk.updateModelRoute({ path: { id }, body })); }
export async function deleteModelRoute(id: string) { return unwrapApiResult(await sdk.deleteModelRoute({ path: { id } })); }
export async function listPlatformLogs(query: { limit: number; offset: number; level?: string }) { return unwrapApiResult(await sdk.listPlatformLogs({ query })); }
export async function clearPlatformLogs() { return unwrapApiResult(await sdk.clearPlatformLogs()); }
