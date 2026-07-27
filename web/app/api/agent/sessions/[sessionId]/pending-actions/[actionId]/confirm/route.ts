import { proxyBackendJson } from "../../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ sessionId: string; actionId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { sessionId, actionId } = await params;
  return proxyBackendJson(
    request,
    `/api/agent/sessions/${encodeURIComponent(sessionId)}/pending-actions/${encodeURIComponent(actionId)}/confirm`,
    "POST",
  );
}
