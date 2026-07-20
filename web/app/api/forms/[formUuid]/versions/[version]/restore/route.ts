import { proxyBackendJson } from "../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ formUuid: string; version: string }> };

export async function POST(request: Request, { params }: Context) {
  const { formUuid, version } = await params;
  return proxyBackendJson(request, `/api/forms/${encodeURIComponent(formUuid)}/versions/${encodeURIComponent(version)}/restore`);
}
