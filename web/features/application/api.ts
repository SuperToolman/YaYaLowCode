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

export function getAppBusinessContext<T>(appId: string) {
  return requestApi<T>(`/api/apps/${encodeURIComponent(appId)}/business-context`, { cache: "no-store" });
}

export function updateAppBusinessContext<T>(appId: string, body: unknown) {
  return requestApi<T>(`/api/apps/${encodeURIComponent(appId)}/business-context`, jsonRequest(body, { method: "PATCH" }));
}

export type { App } from "@/app/lib/api-client";
