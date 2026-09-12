import { agentRuntimeBaseUrl } from "../../../../../../_lib/agent-runtime-proxy";
type Context = { params: Promise<{ sessionId: string; artifactId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { sessionId, artifactId } = await params;
  const headers: Record<string,string> = {};
  const auth = request.headers.get("authorization");
  if (auth) headers.authorization = auth;
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const response = await fetch(
    `${agentRuntimeBaseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
    { headers, cache: "no-store" }
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
