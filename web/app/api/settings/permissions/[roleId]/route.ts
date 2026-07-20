import { getRolePermissions, updateRolePermissions } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ roleId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { roleId } = await params;
  return sdkJsonResponse(getRolePermissions({ client: createBackendSdkClient(request), path: { roleId } }));
}

export async function PUT(request: Request, { params }: Context) {
  const { roleId } = await params;
  return sdkJsonResponse(updateRolePermissions({ client: createBackendSdkClient(request), path: { roleId }, body: await request.json() }));
}
