import { proxyAgentRuntimeJson } from "../../_lib/agent-runtime-proxy";

export async function GET(request: Request) {
  return proxyAgentRuntimeJson(request, `/api/agent/available-agents${new URL(request.url).search}`);
}
