import { createConfigProfile, listConfigProfiles } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";

export async function GET(request: Request) {
  return sdkJsonResponse(listConfigProfiles({ client: createBackendSdkClient(request) }));
}

export async function POST(request: Request) {
  return sdkJsonResponse(createConfigProfile({ client: createBackendSdkClient(request), body: await request.json() }));
}
