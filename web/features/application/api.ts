export {
  createApp,
  createForm,
  createNavigationGroup,
  deleteApp,
  deleteForm,
  deleteNavigationGroup,
  listAppNavigation,
  listApps,
  moveFormNavigation,
  reorderNavigationItem,
  setDefaultNavigationEntry,
  updateApp,
  updateFormName,
  updateNavigationGroup,
} from "@/app/lib/api-client";
import { jsonRequest, requestApi } from "@lib/api-request";

export function syncMarketplaceApplications<T>() {
  return requestApi<T>("/api/market/applications/sync", { method: "POST" });
}

export function submitAppToMarketplace<T>(appId: string) {
  return requestApi<T>(`/api/apps/${encodeURIComponent(appId)}/market-submission`, { method: "POST" });
}

export function getMarketplaceApplication<T>(productId: string) {
  return requestApi<T>(`/api/market/applications/${encodeURIComponent(productId)}`, { cache: "no-store" });
}

export function installMarketplaceApplication<T>(productId: string) {
  return requestApi<T>(`/api/market/applications/${encodeURIComponent(productId)}/installations`, { method: "POST" });
}

export function listMarketplaceApplications<T>() {
  return requestApi<T>("/api/market/applications", { cache: "no-store" });
}

export function preflightMarketplaceApplication<T>(productId: string) {
  return requestApi<T>(`/api/market/applications/${encodeURIComponent(productId)}/preflight`, { cache: "no-store" });
}

export function listMarketplaceInstallations<T>() { return requestApi<T>("/api/market/installations", { cache: "no-store" }); }
export function preflightMarketplaceInstallation<T>(installationId: string) { return requestApi<T>(`/api/market/installations/${encodeURIComponent(installationId)}/preflight`, { cache: "no-store" }); }
export function upgradeMarketplaceInstallation<T>(installationId: string) { return requestApi<T>(`/api/market/installations/${encodeURIComponent(installationId)}/upgrade`, { method: "POST" }); }
export function rollbackMarketplaceInstallation<T>(installationId: string, releaseId: string) { return requestApi<T>(`/api/market/installations/${encodeURIComponent(installationId)}/rollback`, jsonRequest({ releaseId }, { method: "POST" })); }
export function archiveMarketplaceInstallation<T>(installationId: string) { return requestApi<T>(`/api/market/installations/${encodeURIComponent(installationId)}`, { method: "DELETE" }); }
export function restoreMarketplaceInstallation<T>(installationId: string) { return requestApi<T>(`/api/market/installations/${encodeURIComponent(installationId)}/restore`, { method: "POST" }); }
export function purgeMarketplaceInstallation<T>(installationId: string) { return requestApi<T>(`/api/market/installations/${encodeURIComponent(installationId)}/purge`, { method: "DELETE" }); }

export function getAppBusinessContext<T>(appId: string) {
  return requestApi<T>(`/api/apps/${encodeURIComponent(appId)}/business-context`, { cache: "no-store" });
}

export function updateAppBusinessContext<T>(appId: string, body: unknown) {
  return requestApi<T>(`/api/apps/${encodeURIComponent(appId)}/business-context`, jsonRequest(body, { method: "PATCH" }));
}

export type { App } from "@/app/lib/api-client";
