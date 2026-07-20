import { createFormRecord } from "../../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";
import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ formUuid: string }> };

export async function GET(request: Request, { params }: Context) {
  const { formUuid } = await params;
  const query = new URL(request.url).search;
  return proxyBackendJson(request, `/api/forms/${encodeURIComponent(formUuid)}/records${query}`);
}

export async function POST(request: Request, { params }: Context) {
  const { formUuid } = await params;
  return sdkJsonResponse(createFormRecord({ client: createBackendSdkClient(request), path: { formUuid }, body: await request.json() }));
}
