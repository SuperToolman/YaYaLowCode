import { proxyBackendJson } from "../../../_lib/backend-json-proxy";
export async function PUT(request: Request, { params }: { params: Promise<{ knowledgeBaseId: string }> }) { const { knowledgeBaseId } = await params; return proxyBackendJson(request, `/api/agent/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`); }
export async function DELETE(request: Request, { params }: { params: Promise<{ knowledgeBaseId: string }> }) { const { knowledgeBaseId } = await params; return proxyBackendJson(request, `/api/agent/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`); }
