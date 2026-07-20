import { listPersonas } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";
export async function GET(request: Request) { return sdkJsonResponse(listPersonas({ client: createBackendSdkClient(request) })); }
