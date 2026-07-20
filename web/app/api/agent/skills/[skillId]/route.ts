import { deleteSkill, updateSkill } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
export async function PUT(request: Request, { params }: { params: Promise<{ skillId: string }> }) { const { skillId } = await params; return sdkJsonResponse(updateSkill({ client: createBackendSdkClient(request), path: { id: skillId }, body: await request.json() })); }
export async function DELETE(request: Request, { params }: { params: Promise<{ skillId: string }> }) { const { skillId } = await params; return sdkJsonResponse(deleteSkill({ client: createBackendSdkClient(request), path: { id: skillId } })); }
