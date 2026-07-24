import { backendAuthorizationHeaders, backendBaseUrl } from "../../../_lib/backend-json-proxy";

export async function POST(request: Request) {
  const response = await fetch(`${backendBaseUrl}/api/agent/skills/import`, {
    method: "POST",
    headers: backendAuthorizationHeaders(request),
    body: await request.formData(),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
