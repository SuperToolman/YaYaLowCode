import { deleteFormRecord, updateFormRecord } from "../../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ formUuid: string; recordUuid: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { formUuid, recordUuid } = await params;
  return sdkJsonResponse(updateFormRecord({ client: createBackendSdkClient(request), path: { formUuid, recordUuid }, body: await request.json() }));
}

export async function DELETE(request: Request, { params }: Context) {
  const { formUuid, recordUuid } = await params;
  return sdkJsonResponse(deleteFormRecord({ client: createBackendSdkClient(request), path: { formUuid, recordUuid } }));
}
