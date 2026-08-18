import { proxyAgentRuntimeJson, proxyAgentRuntimeStream } from "../../../../_lib/agent-runtime-proxy";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyAgentRuntimeJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`);
}

export async function POST(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyAgentRuntimeStream(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`);
}
