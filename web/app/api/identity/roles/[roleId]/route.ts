import { deleteLocalRole, updateLocalRole } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ roleId: string }> };
export async function PUT(request: Request, { params }: Context) { const { roleId } = await params; return sdkJsonResponse(updateLocalRole({ client: createBackendSdkClient(request), path: { roleId }, body: await request.json() })); }
export async function DELETE(request: Request, { params }: Context) { const { roleId } = await params; return sdkJsonResponse(deleteLocalRole({ client: createBackendSdkClient(request), path: { roleId } })); }
