import { createApp, listApps } from "../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../_lib/backend-sdk-client";

export async function GET(request: Request) {
  return sdkJsonResponse(listApps({ client: createBackendSdkClient(request) }));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    owner?: string;
  };
  return sdkJsonResponse(
    createApp({ client: createBackendSdkClient(request), body }),
  );
}
