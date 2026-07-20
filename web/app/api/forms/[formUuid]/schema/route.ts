import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ formUuid: string }> };

export async function GET(request: Request, { params }: Context) {
  const { formUuid } = await params;
  const query = new URL(request.url).search;
  return proxyBackendJson(request, `/api/forms/${encodeURIComponent(formUuid)}/schema${query}`);
}
