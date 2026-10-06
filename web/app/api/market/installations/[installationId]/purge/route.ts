import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";

export async function DELETE(request: Request, { params }: { params: Promise<{ installationId: string }> }) { const { installationId } = await params; return proxyBackendJson(request, `/api/market/installations/${encodeURIComponent(installationId)}/purge`); }
