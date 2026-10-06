import { backendAuthorizationHeaders, backendBaseUrl } from "../../../../../../_lib/backend-json-proxy";
type Context = { params: Promise<{ sessionId: string; artifactId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { sessionId, artifactId } = await params;
  const response = await fetch(
    `${backendBaseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
    { headers: backendAuthorizationHeaders(request), cache: "no-store" }
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": response.headers.get("content-disposition") ?? "attachment",
      ...(response.headers.get("content-length")
        ? { "content-length": response.headers.get("content-length") as string }
        : {})
    }
  });
}
