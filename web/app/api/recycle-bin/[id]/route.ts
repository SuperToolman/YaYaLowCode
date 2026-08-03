import { proxyBackendJson } from "../../_lib/backend-json-proxy";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; return proxyBackendJson(request, `/api/recycle-bin/${encodeURIComponent(id)}`); }
