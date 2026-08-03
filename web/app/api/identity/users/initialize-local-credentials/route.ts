import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function POST(request: Request) {
  return proxyBackendJson(request, "/api/identity/users/initialize-local-credentials");
}
