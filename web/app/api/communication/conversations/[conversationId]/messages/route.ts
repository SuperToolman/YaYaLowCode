import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { conversationId } = await params;
  const query = new URL(request.url).search;
  return proxyBackendJson(request, `/api/communication/conversations/${encodeURIComponent(conversationId)}/messages${query}`);
}
export async function POST(request: Request, { params }: Context) {
  const { conversationId } = await params;
  return proxyBackendJson(request, `/api/communication/conversations/${encodeURIComponent(conversationId)}/messages`);
}
