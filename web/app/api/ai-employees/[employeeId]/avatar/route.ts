import { backendBaseUrl, backendAuthorizationHeaders } from "../../../_lib/backend-json-proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await params;
  try {
    const response = await fetch(
      `${backendBaseUrl}/api/settings/ai-employee-market/${encodeURIComponent(employeeId)}/avatar`,
      { cache: "no-store", headers: backendAuthorizationHeaders(_request) },
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "image/webp",
        // The operation center replaces the file when an avatar is updated;
        // avoid serving a stale browser/proxy cache under the stable URL.
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("头像服务不可用", { status: 503 });
  }
}
