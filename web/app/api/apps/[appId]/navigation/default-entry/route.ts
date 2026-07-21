import { setDefaultNavigationEntry, type SetDefaultNavigationEntryRequest } from "../../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ appId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { appId } = await params;
  const body = (await request.json()) as SetDefaultNavigationEntryRequest;
  return sdkJsonResponse(
    setDefaultNavigationEntry({
      client: createBackendSdkClient(request),
      path: { appId },
      body,
    }),
  );
}
