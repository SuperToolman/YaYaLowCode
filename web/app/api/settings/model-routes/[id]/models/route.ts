import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return proxyBackendJson(request, `/api/settings/model-routes/${encodeURIComponent((await params).id)}/models`);
}
