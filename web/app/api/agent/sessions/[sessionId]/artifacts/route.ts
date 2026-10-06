import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";
type Context = { params: Promise<{ sessionId: string }> };
export async function GET(request: Request, { params }: Context) { const { sessionId } = await params; const query = new URL(request.url).search; return proxyBackendJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts${query}`); }
