import { clearDingTalkData } from "../../../../../lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

export async function POST(request: Request) {
  return sdkJsonResponse(clearDingTalkData({ client: createBackendSdkClient(request) }));
}
