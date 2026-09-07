import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";

export async function POST(request: Request) {
  return proxyBackendJson(request, "/api/market/applications/sync");
}
