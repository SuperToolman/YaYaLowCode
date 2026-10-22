import { submitViewButton } from "@/app/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ formUuid: string; viewUuid: string; buttonUuid: string }> };
export async function POST(request: Request, { params }: Context) { return sdkJsonResponse(submitViewButton({ client: createBackendSdkClient(request), path: await params, body: await request.json() })); }
