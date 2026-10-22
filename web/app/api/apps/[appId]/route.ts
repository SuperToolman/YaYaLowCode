import { proxyBackendJson } from "../../_lib/backend-json-proxy";
export async function GET(request: Request, context: { params: Promise<{ appId: string }> }) {
  const { appId } = await context.params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}`);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ appId: string }> },
) {
  const { appId } = await context.params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}`);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ appId: string }> },
) {
  const { appId } = await context.params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}`);
}
