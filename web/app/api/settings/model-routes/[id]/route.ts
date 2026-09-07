import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) { return proxyBackendJson(request, `/api/settings/model-routes/${encodeURIComponent((await params).id)}`); }
export async function DELETE(request: Request, { params }: Context) { return proxyBackendJson(request, `/api/settings/model-routes/${encodeURIComponent((await params).id)}`); }
