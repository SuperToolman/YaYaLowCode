import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function GET(request: Request) {
  const query = new URL(request.url).search;
  return proxyBackendJson(request, `/api/workflow/tasks${query}`);
}
