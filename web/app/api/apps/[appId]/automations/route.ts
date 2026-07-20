import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ appId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { appId } = await params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}/automations`);
}

export async function POST(request: Request, { params }: Context) {
  const { appId } = await params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}/automations`);
}
