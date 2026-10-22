import { listViewButtons } from "@/app/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../../_lib/backend-sdk-client";
type Context = { params: Promise<{ formUuid: string; viewUuid: string }> };
export async function GET(request: Request, { params }: Context) { return sdkJsonResponse(listViewButtons({ client: createBackendSdkClient(request), path: await params })); }
