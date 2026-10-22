import { proxyBackendJson } from "../../../_lib/backend-json-proxy";
export async function GET(request: Request, context: { params: Promise<{ uid: string }> }) {
  const { uid } = await context.params;
  return proxyBackendJson(request, `/api/mail/messages/${encodeURIComponent(uid)}${new URL(request.url).search}`);
}
