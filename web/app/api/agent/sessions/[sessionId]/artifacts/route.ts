import { proxyAgentRuntimeJson } from "../../../../_lib/agent-runtime-proxy";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(request: Request, { params }: Context) { const { sessionId } = await params; const query = new URL(request.url).search; return proxyAgentRuntimeJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts${query}`); }
