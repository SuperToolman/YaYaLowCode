import { proxyBackendJson } from "../../_lib/backend-json-proxy";

export async function PUT(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return proxyBackendJson(request, `/api/agents/${encodeURIComponent(agentId)}`);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return proxyBackendJson(request, `/api/agents/${encodeURIComponent(agentId)}`);
}
