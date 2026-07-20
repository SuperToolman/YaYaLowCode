import { publishFormSchema } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ formUuid: string }> };

export async function POST(request: Request, { params }: Context) {
  const { formUuid } = await params;
  return sdkJsonResponse(publishFormSchema({ client: createBackendSdkClient(request), path: { formUuid } }));
}
