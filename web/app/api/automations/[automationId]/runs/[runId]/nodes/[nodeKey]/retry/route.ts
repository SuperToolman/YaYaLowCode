import { proxyBackendJson } from "../../../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ automationId: string; runId: string; nodeKey: string }> };

export async function POST(request: Request, { params }: Context) {
  const { automationId, runId, nodeKey } = await params;
  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeKey)}/retry`);
}
