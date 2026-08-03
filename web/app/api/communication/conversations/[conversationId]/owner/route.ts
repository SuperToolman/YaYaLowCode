import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";
export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) { const { conversationId } = await context.params; return proxyBackendJson(request, `/api/communication/conversations/${encodeURIComponent(conversationId)}/owner`); }
