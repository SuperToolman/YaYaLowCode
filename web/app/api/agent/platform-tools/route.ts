import { listPlatformTools } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";

export async function GET(request: Request) {
  return sdkJsonResponse(listPlatformTools({ client: createBackendSdkClient(request) }));
}
