import { fetchWithControl } from "@lib/api-request";
import { backendAuthorizationHeaders, backendBaseUrl } from "../../../../../_lib/backend-json-proxy";

export async function GET(request: Request, context: { params: Promise<{ uid: string; attachmentId: string }> }) {
  const { uid, attachmentId } = await context.params;
  try {
    const response = await fetchWithControl(`${backendBaseUrl}/api/mail/messages/${encodeURIComponent(uid)}/attachments/${encodeURIComponent(attachmentId)}${new URL(request.url).search}`, {
      signal: request.signal, headers: backendAuthorizationHeaders(request), cache: "no-store", bufferResponse: false,
    });
    const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    for (const name of ["content-type", "content-disposition"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ code: 503, message: "附件下载服务暂时不可用", data: null }, { status: 503 });
  }
}
