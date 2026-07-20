import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyBackendJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`);
}

export async function POST(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyBackendJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`);
}
