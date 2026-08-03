import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ conversationId: string }> };
export async function POST(request: Request, { params }: Context) {
  const { conversationId } = await params;
  return proxyBackendJson(request, `/api/communication/conversations/${encodeURIComponent(conversationId)}/read`);
}
