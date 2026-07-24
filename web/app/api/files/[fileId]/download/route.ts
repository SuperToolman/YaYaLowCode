import { backendAuthorizationHeaders } from "../../../_lib/backend-json-proxy";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";
type Context = { params: Promise<{ fileId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { fileId } = await params;
  const response = await fetch(`${backendBaseUrl}/api/files/${encodeURIComponent(fileId)}/download`, {
    headers: backendAuthorizationHeaders(request), cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: {
    "content-type": response.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": response.headers.get("content-disposition") ?? "attachment",
  }});
}
