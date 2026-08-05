import { proxyBackendJson } from "../../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ appId: string; formUuid: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { appId, formUuid } = await params;
  return proxyBackendJson(
    request,
    `/api/apps/${encodeURIComponent(appId)}/navigation/forms/${encodeURIComponent(formUuid)}`,
  );
}
