import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";

export async function GET(request: Request) {
  return proxyBackendJson(
    request,
    `/api/agent/workbench/sessions${new URL(request.url).search}`,
  );
}
