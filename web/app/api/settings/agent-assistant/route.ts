import { proxyBackendJson } from "../../_lib/backend-json-proxy";

export async function GET(request: Request) { return proxyBackendJson(request, "/api/settings/agent-assistant"); }
export async function PUT(request: Request) { return proxyBackendJson(request, "/api/settings/agent-assistant"); }
