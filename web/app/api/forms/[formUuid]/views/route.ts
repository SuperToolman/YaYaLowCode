import { createFormView, listFormViews } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ formUuid: string }> };
export async function GET(request: Request, { params }: Context) { const { formUuid } = await params; return sdkJsonResponse(listFormViews({ client: createBackendSdkClient(request), path: { formUuid } })); }
export async function POST(request: Request, { params }: Context) { const { formUuid } = await params; return sdkJsonResponse(createFormView({ client: createBackendSdkClient(request), path: { formUuid }, body: await request.json() })); }
