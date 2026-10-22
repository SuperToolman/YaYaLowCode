import { deleteCustomButton, getCustomButton, updateCustomButton } from "@/app/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ formUuid: string; buttonId: string }> };

export async function GET(request: Request, { params }: Context) {
  return sdkJsonResponse(getCustomButton({ client: createBackendSdkClient(request), path: await params }));
}

export async function PATCH(request: Request, { params }: Context) {
  return sdkJsonResponse(updateCustomButton({ client: createBackendSdkClient(request), path: await params, body: await request.json() }));
}

export async function DELETE(request: Request, { params }: Context) {
  return sdkJsonResponse(deleteCustomButton({ client: createBackendSdkClient(request), path: await params }));
}
