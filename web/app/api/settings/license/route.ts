import { proxyBackendJson } from "../../_lib/backend-json-proxy";

export async function GET(request: Request) {
  return proxyBackendJson(request, "/api/settings/license");
}

export async function POST(request: Request) {
  return proxyBackendJson(request, "/api/settings/license");
}
