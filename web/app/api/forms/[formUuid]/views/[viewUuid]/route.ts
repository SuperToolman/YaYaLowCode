import { deleteFormView, updateFormView } from "../../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ formUuid: string; viewUuid: string }> };
export async function PUT(request: Request, { params }: Context) { const { formUuid, viewUuid } = await params; return sdkJsonResponse(updateFormView({ client: createBackendSdkClient(request), path: { formUuid, viewUuid }, body: await request.json() })); }
export async function DELETE(request: Request, { params }: Context) { const { formUuid, viewUuid } = await params; return sdkJsonResponse(deleteFormView({ client: createBackendSdkClient(request), path: { formUuid, viewUuid } })); }
