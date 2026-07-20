import { deleteProvider, updateProvider } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

export async function PUT(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return sdkJsonResponse(updateProvider({ client: createBackendSdkClient(request), path: { id: providerId }, body: await request.json() }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return sdkJsonResponse(deleteProvider({ client: createBackendSdkClient(request), path: { id: providerId } }));
}
