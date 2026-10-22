import { listViewButtonOptions } from "@/app/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ formUuid: string }> };
export async function GET(request: Request, { params }: Context) { return sdkJsonResponse(listViewButtonOptions({ client: createBackendSdkClient(request), path: await params })); }
