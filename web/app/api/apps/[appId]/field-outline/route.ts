import { getAppFieldOutline } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ appId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { appId } = await params;
  return sdkJsonResponse(
    getAppFieldOutline({ client: createBackendSdkClient(request), path: { appId } }),
  );
}
