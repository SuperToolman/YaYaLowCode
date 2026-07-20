import { deleteConfigProfile, updateConfigProfile } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

export async function PUT(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  return sdkJsonResponse(updateConfigProfile({ client: createBackendSdkClient(request), path: { id: profileId }, body: await request.json() }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  return sdkJsonResponse(deleteConfigProfile({ client: createBackendSdkClient(request), path: { id: profileId } }));
}
