import {
  listAppNavigation,
  listApps,
  listForms,
  type App,
  type FormSummary,
  type NavigationItem,
} from "./api-client";

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
    const { data, error } = await listApps({ responseStyle: "fields" });
    if (error || !data || data.code !== 0 || !data.data) {
      throw new Error(data?.message || "无法加载应用");
    }
    const app = data.data.find((item) => item.id === appId);
    if (!app) throw new Error("应用不存在");
    return app as App;
  }, force);
}

export function getAppForms(appId: string, force = false) {
  return loadCached(appId, "forms", async () => {
    const { data, error } = await listForms({
      path: { appId },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) {
      throw new Error(data?.message || "无法加载表单");
    }
    return data.data as FormSummary[];
  }, force);
}

export function getAppNavigation(appId: string, force = false) {
  return loadCached(appId, "navigation", async () => {
    const { data, error } = await listAppNavigation({
      path: { appId },
      responseStyle: "fields",
    });
    if (error || !data || data.code !== 0 || !data.data) {
      throw new Error(data?.message || "无法加载导航");
    }
    return data.data as NavigationItem[];
  }, force);
}

export function invalidateAppResources(appId: string, resources: ResourceKind[] = ["app", "forms", "navigation"]) {
  for (const resource of resources) resourceCache.delete(cacheKey(appId, resource));
}
