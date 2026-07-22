import { createForm, listForms } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ appId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { appId } = await params;
  return sdkJsonResponse(
    listForms({ client: createBackendSdkClient(request), path: { appId } }),
  );
}

export async function POST(request: Request, { params }: Context) {
  const { appId } = await params;
  const body = await request.json().catch(() => undefined);
  return sdkJsonResponse(
    createForm({ client: createBackendSdkClient(request), path: { appId }, body }),
  );
}
