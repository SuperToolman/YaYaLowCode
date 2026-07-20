import { deletePlugin, updatePlugin } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
export async function PUT(request: Request, { params }: { params: Promise<{ pluginId: string }> }) { const { pluginId } = await params; return sdkJsonResponse(updatePlugin({ client: createBackendSdkClient(request), path: { id: pluginId }, body: await request.json() })); }
export async function DELETE(request: Request, { params }: { params: Promise<{ pluginId: string }> }) { const { pluginId } = await params; return sdkJsonResponse(deletePlugin({ client: createBackendSdkClient(request), path: { id: pluginId } })); }
