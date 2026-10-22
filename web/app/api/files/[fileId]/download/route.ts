import { proxyBackendFile } from "../../../_lib/backend-json-proxy";
export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await context.params;
  return proxyBackendFile(request, `/api/files/${encodeURIComponent(fileId)}/download`);
}
