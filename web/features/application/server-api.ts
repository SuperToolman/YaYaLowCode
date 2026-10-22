import { cookies } from "next/headers";
import { createBackendSdkClient } from "@lib/backend-client";
import { getApp, listAppNavigation } from "@lib/http";
import { ApiRequestError, unwrapApiResult } from "@lib/api-request";

async function requestClient() {
  const cookieStore = await cookies();
  return createBackendSdkClient(new Request("http://localhost", { headers: { cookie: cookieStore.toString() } }));
}
export async function getRuntimeApp(appId: string) {
  const result = await getApp({ client: await requestClient(), path: { appId }, cache: "no-store" });
  try { return unwrapApiResult(result); }
  catch (error) { if (error instanceof ApiRequestError && (error.kind === "http" || error.kind === "business")) return null; throw error; }
}
export async function getRuntimeAppNavigation(appId: string) {
  const result = await listAppNavigation({ client: await requestClient(), path: { appId }, cache: "no-store" });
  try { return unwrapApiResult(result); }
  catch (error) { if (error instanceof ApiRequestError && (error.kind === "http" || error.kind === "business")) return null; throw error; }
}
