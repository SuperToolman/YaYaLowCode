import { proxyBackendJson } from "../../_lib/backend-json-proxy";

export async function GET(request: Request) {
  return proxyBackendJson(request, `/api/settings/logs${new URL(request.url).search}`);
}

export async function DELETE(request: Request) {
  return proxyBackendJson(request, "/api/settings/logs");
}
