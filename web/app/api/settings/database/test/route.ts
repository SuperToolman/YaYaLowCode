import { testDatabaseConnection } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

export async function POST(request: Request) {
  return sdkJsonResponse(
    testDatabaseConnection({
      client: createBackendSdkClient(request),
      body: await request.json(),
    }),
  );
}
