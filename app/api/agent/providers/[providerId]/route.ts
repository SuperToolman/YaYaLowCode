import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function PUT(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return proxyBackendJson(request, `/api/agent/providers/${encodeURIComponent(providerId)}`);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return proxyBackendJson(request, `/api/agent/providers/${encodeURIComponent(providerId)}`);
}
