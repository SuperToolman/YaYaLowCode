import { refreshDingTalkAccessToken } from "../../../../../../shared/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

export async function POST(request: Request) {
  return sdkJsonResponse(refreshDingTalkAccessToken({ client: createBackendSdkClient(request) }));
}
