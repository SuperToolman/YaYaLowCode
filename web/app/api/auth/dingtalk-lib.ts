const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8788";

import { getInternalIdentitySourceSettings } from "@lib/http";
import { createBackendSdkClient } from "@lib/backend-client";
import { unwrapApiResult } from "@lib/api-request";
export type DingTalkSettings = { clientId: string; clientSecret: string };
export async function getDingTalkSettings(): Promise<DingTalkSettings> {
  const internalToken = process.env.BACKEND_INTERNAL_TOKEN ?? process.env.AUTH_TOKEN_SECRET ?? "yaya-development-token-secret";
  const result = await getInternalIdentitySourceSettings({ client: createBackendSdkClient(new Request("http://localhost")), headers: { "x-yaya-internal-token": internalToken }, cache: "no-store" });
  const { dingtalk } = unwrapApiResult(result);
  return { clientId: dingtalk.clientId.trim(), clientSecret: dingtalk.clientSecret.trim() };
}

export function safeRedirect(redirect: string | null) {
  return redirect
    && redirect.startsWith("/")
    && !redirect.startsWith("//")
    && !redirect.startsWith("/login")
    ? redirect
    : "/";
}

export { backendBaseUrl };
