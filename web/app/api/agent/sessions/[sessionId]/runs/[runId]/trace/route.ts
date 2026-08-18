import { proxyAgentRuntimeJson } from "../../../../../../_lib/agent-runtime-proxy";

type Context = { params: Promise<{ sessionId: string; runId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { sessionId, runId } = await params;
  return proxyAgentRuntimeJson(
    request,
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/trace`,
  );
}
