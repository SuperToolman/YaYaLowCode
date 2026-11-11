import { proxyBackendJson, proxyBackendFile } from "../../_lib/backend-json-proxy";
export const runtime = "nodejs";
type Context = { params: Promise<{ segments: string[] }> };
async function proxy(request: Request, { params }: Context) {
  const { segments } = await params;
  const path = `/api/knowledge/${segments.map(encodeURIComponent).join("/")}${new URL(request.url).search}`;
  return request.headers
    .get("content-type")
    ?.startsWith("application/octet-stream") || segments.at(-1) === "content"
    ? proxyBackendFile(request, path, 8 * 1024 * 1024)
    : proxyBackendJson(request, path);
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
