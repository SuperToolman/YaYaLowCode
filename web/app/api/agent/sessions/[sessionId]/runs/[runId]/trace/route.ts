import { proxyBackendJson } from "../../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ sessionId: string; runId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { sessionId, runId } = await params;
  return proxyBackendJson(
    request,
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/trace`,
  );
}
