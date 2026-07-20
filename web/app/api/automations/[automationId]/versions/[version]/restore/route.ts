import { proxyBackendJson } from "../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ automationId: string; version: string }> };

export async function POST(request: Request, { params }: Context) {
  const { automationId, version } = await params;
  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}/versions/${encodeURIComponent(version)}/restore`);
}
