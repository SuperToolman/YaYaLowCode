import { createProvider, listProviders } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";

export async function GET(request: Request) {
  return sdkJsonResponse(listProviders({ client: createBackendSdkClient(request) }));
}

export async function POST(request: Request) {
  return sdkJsonResponse(createProvider({ client: createBackendSdkClient(request), body: await request.json() }));
}
