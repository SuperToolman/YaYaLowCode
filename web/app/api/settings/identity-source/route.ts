import { getIdentitySourceSettings, updateIdentitySourceSettings } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";

export async function GET(request: Request) {
  return sdkJsonResponse(getIdentitySourceSettings({ client: createBackendSdkClient(request) }));
}

export async function PUT(request: Request) {
  return sdkJsonResponse(updateIdentitySourceSettings({ client: createBackendSdkClient(request), body: await request.json() }));
}
