import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ formUuid: string }> };

export async function POST(request: Request, { params }: Context) {
  const { formUuid } = await params;
  return proxyBackendJson(
    request,
    `/api/forms/${encodeURIComponent(formUuid)}/workflow/process`,
  );
}
