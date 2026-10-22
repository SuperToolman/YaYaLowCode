import { unwrapApiResult } from "./api-request";
import {
  listAppNavigation,
  listApps,
  listForms,
} from "./http";

type ResourceKind = "app" | "forms" | "navigation";

const resourceCache = new Map<string, Promise<unknown>>();

function cacheKey(appId: string, kind: ResourceKind) {
  return `${kind}:${appId}`;
}

function loadCached<T>(appId: string, kind: ResourceKind, loader: () => Promise<T>, force = false) {
  const key = cacheKey(appId, kind);
  if (force) resourceCache.delete(key);
  const existing = resourceCache.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = loader().catch((error) => {
    resourceCache.delete(key);
    throw error;
  });
  resourceCache.set(key, request);
  return request;
}

export function getAppResource(appId: string, force = false) {
  return loadCached(appId, "app", async () => {
    const result = await listApps({ responseStyle: "fields" });
    const app = unwrapApiResult(result, "无法加载应用").find((item) => item.id === appId);
    if (!app) throw new Error("应用不存在");
    return app;
  }, force);
}

export function getAppForms(appId: string, force = false) {
  return loadCached(appId, "forms", async () => {
    const result = await listForms({
      path: { appId },
      responseStyle: "fields",
    });
    return unwrapApiResult(result, "无法加载表单");
  }, force);
}

export function getAppNavigation(appId: string, force = false) {
  return loadCached(appId, "navigation", async () => {
    const result = await listAppNavigation({
      path: { appId },
      responseStyle: "fields",
    });
    return unwrapApiResult(result, "无法加载导航");
  }, force);
}

export function invalidateAppResources(appId: string, resources: ResourceKind[] = ["app", "forms", "navigation"]) {
  for (const resource of resources) resourceCache.delete(cacheKey(appId, resource));
}

export function clearAppResourceCache() {
  resourceCache.clear();
}
