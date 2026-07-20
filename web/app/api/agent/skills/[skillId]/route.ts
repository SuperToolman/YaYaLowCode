import { proxyBackendJson } from "../../../_lib/backend-json-proxy";
export async function PUT(request: Request, { params }: { params: Promise<{ skillId: string }> }) { const { skillId } = await params; return proxyBackendJson(request, `/api/agent/skills/${encodeURIComponent(skillId)}`); }
export async function DELETE(request: Request, { params }: { params: Promise<{ skillId: string }> }) { const { skillId } = await params; return proxyBackendJson(request, `/api/agent/skills/${encodeURIComponent(skillId)}`); }
