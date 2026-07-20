import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function PUT(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  return proxyBackendJson(request, `/api/agent/config-profiles/${encodeURIComponent(profileId)}`);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  return proxyBackendJson(request, `/api/agent/config-profiles/${encodeURIComponent(profileId)}`);
}
