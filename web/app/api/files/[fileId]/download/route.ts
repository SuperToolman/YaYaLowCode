import { backendAuthorizationHeaders, backendBaseUrl } from "../../../_lib/backend-json-proxy";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await context.params;
    const response = await fetch(`${backendBaseUrl}/api/files/${encodeURIComponent(fileId)}/download`, {
      headers: backendAuthorizationHeaders(request),
      cache: "no-store",
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch {
    return Response.json({ code: 503, data: null, message: "backend unavailable" }, { status: 503 });
  }
}
