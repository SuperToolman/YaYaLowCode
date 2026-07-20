import { deleteUser, updateUser } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ userId: string }> };
export async function PUT(request: Request, { params }: Context) { const { userId } = await params; return sdkJsonResponse(updateUser({ client: createBackendSdkClient(request), path: { userId }, body: await request.json() })); }
export async function DELETE(request: Request, { params }: Context) { const { userId } = await params; return sdkJsonResponse(deleteUser({ client: createBackendSdkClient(request), path: { userId } })); }
