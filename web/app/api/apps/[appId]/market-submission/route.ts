import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}/market-submission`);
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  return proxyBackendJson(request, `/api/apps/${encodeURIComponent(appId)}/market-submission`);
}
