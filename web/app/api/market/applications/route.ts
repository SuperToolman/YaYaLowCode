import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";

export async function GET(request: Request) {
  return proxyBackendJson(request, "/api/market/applications");
}
