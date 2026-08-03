import { proxyBackendJson } from "../../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ conversationId: string; messageId: string }> };
export async function POST(request: Request, { params }: Context) {
  const { conversationId, messageId } = await params;
  return proxyBackendJson(request, `/api/communication/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/recall`);
}
