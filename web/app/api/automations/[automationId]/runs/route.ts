import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ automationId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { automationId } = await params;
  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}/runs`);
}
