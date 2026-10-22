import type { LoginSession } from "./contracts";
import { getAuthorizationGrants as grants } from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";
import { jsonRequest, requestApi } from "@lib/api-request";

export function loginWithPassword(username: string, password: string) {
  return requestApi<LoginSession>("/api/auth/login", { ...jsonRequest({ username, password }, { method: "POST" }), suppressAuthNotification: true });
}

export function getAuthSession() {
  return requestApi<LoginSession>("/api/auth/session", { cache: "no-store", suppressAuthNotification: true });
}

export function sendSmsCode(mobile: string) {
  return requestApi<unknown>("/api/auth/sms/send-code", { ...jsonRequest({ mobile }, { method: "POST" }), suppressAuthNotification: true });
}

export function loginWithSms(mobile: string, code: string) {
  return requestApi<LoginSession>("/api/auth/sms/login", { ...jsonRequest({ mobile, code }, { method: "POST" }), suppressAuthNotification: true });
}

export function getAuthorizationGrants() {
  return grants({ cache: "no-store" }).then(result => unwrapApiResult(result));
}

export function logoutSession() {
  return requestApi<unknown>("/api/auth/logout", { method: "POST" });
}
