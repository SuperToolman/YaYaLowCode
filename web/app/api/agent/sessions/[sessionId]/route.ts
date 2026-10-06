import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ sessionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyBackendJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}`);
}

export async function DELETE(request: Request, { params }: Context) {
  const { sessionId } = await params;
  return proxyBackendJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}`);
}
