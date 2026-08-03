import { proxyBackendJson } from "../../_lib/backend-json-proxy";
export async function GET(request: Request) { return proxyBackendJson(request, "/api/settings/recycle-bin"); }
export async function PUT(request: Request) { return proxyBackendJson(request, "/api/settings/recycle-bin"); }
