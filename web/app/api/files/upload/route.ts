import { proxyBackendFile } from "../../_lib/backend-json-proxy";
export async function POST(request: Request) { return proxyBackendFile(request, "/api/files/upload"); }
