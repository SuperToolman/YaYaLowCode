import { syncDingTalkDepartments } from "../../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

export async function POST(request: Request) {
  return sdkJsonResponse(syncDingTalkDepartments({ client: createBackendSdkClient(request) }));
}
