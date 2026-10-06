import { jsonRequest, requestApi } from "@lib/api-request";

export function loginWithPassword<T>(username: string, password: string) {
  return requestApi<T>("/api/auth/login", { ...jsonRequest({ username, password }, { method: "POST" }), suppressAuthNotification: true });
}

export function getAuthSession<T>() {
  return requestApi<T>("/api/auth/session", { cache: "no-store", suppressAuthNotification: true });
}

export function sendSmsCode(mobile: string) {
  return requestApi<unknown>("/api/auth/sms/send-code", { ...jsonRequest({ mobile }, { method: "POST" }), suppressAuthNotification: true });
}

export function loginWithSms<T>(mobile: string, code: string) {
  return requestApi<T>("/api/auth/sms/login", { ...jsonRequest({ mobile, code }, { method: "POST" }), suppressAuthNotification: true });
}

export function getAuthorizationGrants() {
  return requestApi<string[]>("/api/authorization/grants", { cache: "no-store" });
}

export function logoutSession() {
  return requestApi<unknown>("/api/auth/logout", { method: "POST" });
}
