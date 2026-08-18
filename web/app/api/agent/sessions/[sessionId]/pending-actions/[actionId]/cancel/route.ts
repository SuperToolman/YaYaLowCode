import { proxyAgentRuntimeJson } from "../../../../../../_lib/agent-runtime-proxy";

type Context = { params: Promise<{ sessionId: string; actionId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { sessionId, actionId } = await params;
  const path = `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions/${encodeURIComponent(actionId)}/cancel`;
  return proxyAgentRuntimeJson(request, path);
}
