import { proxyBackendJson } from "../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ automationId: string; runId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { automationId, runId } = await params;
  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/retry`);
}
