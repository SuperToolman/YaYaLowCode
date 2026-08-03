import { proxyBackendJson } from "../../_lib/backend-json-proxy";

export async function GET(request: Request) {
  return proxyBackendJson(request, "/api/identity/organization-units");
}

export async function POST(request: Request) {
  return proxyBackendJson(request, "/api/identity/organization-units");
}
