import { jsonRequest, requestApi } from "@lib/api-request";

export function loginWithPassword<T>(username: string, password: string) {
  return requestApi<T>("/api/auth/login", jsonRequest({ username, password }, { method: "POST" }));
}

export function getAuthSession<T>() {
  return requestApi<T>("/api/auth/session", { cache: "no-store" });
}

export function getAuthorizationGrants() {
  return requestApi<string[]>("/api/authorization/grants", { cache: "no-store" });
}

export function logoutSession() {
  return requestApi<unknown>("/api/auth/logout", { method: "POST" });
}
