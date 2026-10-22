import { listButtonAutomationOptions } from "@/app/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ formUuid: string }> };

export async function GET(request: Request, { params }: Context) {
  return sdkJsonResponse(listButtonAutomationOptions({ client: createBackendSdkClient(request), path: await params }));
}
