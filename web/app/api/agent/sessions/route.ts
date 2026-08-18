import { proxyAgentRuntimeJson } from "../../_lib/agent-runtime-proxy";

export async function GET(request: Request) {
  return proxyAgentRuntimeJson(request, "/api/agent/sessions");
}

export async function POST(request: Request) {
  return proxyAgentRuntimeJson(request, "/api/agent/sessions");
}
