import { deleteKnowledgeBase, updateKnowledgeBase } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
export async function PUT(request: Request, { params }: { params: Promise<{ knowledgeBaseId: string }> }) { const { knowledgeBaseId } = await params; return sdkJsonResponse(updateKnowledgeBase({ client: createBackendSdkClient(request), path: { id: knowledgeBaseId }, body: await request.json() })); }
export async function DELETE(request: Request, { params }: { params: Promise<{ knowledgeBaseId: string }> }) { const { knowledgeBaseId } = await params; return sdkJsonResponse(deleteKnowledgeBase({ client: createBackendSdkClient(request), path: { id: knowledgeBaseId } })); }
