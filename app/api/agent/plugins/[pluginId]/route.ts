import { proxyBackendJson } from "../../../_lib/backend-json-proxy";
export async function PUT(request: Request, { params }: { params: Promise<{ pluginId: string }> }) { const { pluginId } = await params; return proxyBackendJson(request, `/api/agent/plugins/${encodeURIComponent(pluginId)}`); }
export async function DELETE(request: Request, { params }: { params: Promise<{ pluginId: string }> }) { const { pluginId } = await params; return proxyBackendJson(request, `/api/agent/plugins/${encodeURIComponent(pluginId)}`); }
