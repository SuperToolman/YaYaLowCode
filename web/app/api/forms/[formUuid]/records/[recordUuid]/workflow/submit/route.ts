import { proxyBackendJson } from "../../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ formUuid: string; recordUuid: string }> };

export async function POST(request: Request, { params }: Context) {
  const { formUuid, recordUuid } = await params;
  return proxyBackendJson(
    request,
    `/api/forms/${encodeURIComponent(formUuid)}/records/${encodeURIComponent(recordUuid)}/workflow/submit`,
  );
}
