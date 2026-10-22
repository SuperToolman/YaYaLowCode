import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function GET(request: Request) {
  const response = await proxyBackendJson(request, "/api/settings/valkey/status");
  response.headers.set("cache-control", "no-store");
  return response;
}
