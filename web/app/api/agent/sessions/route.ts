import { createAgentSession, listAgentSessions } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";

export async function GET(request: Request) {
  return sdkJsonResponse(listAgentSessions({ client: createBackendSdkClient(request) }));
}

export async function POST(request: Request) {
  return sdkJsonResponse(createAgentSession({ client: createBackendSdkClient(request), body: await request.json().catch(() => undefined) }));
}
