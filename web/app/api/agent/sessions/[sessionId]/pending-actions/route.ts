import { proxyAgentRuntimeJson } from "../../../../_lib/agent-runtime-proxy";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyAgentRuntimeJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions`);
}
