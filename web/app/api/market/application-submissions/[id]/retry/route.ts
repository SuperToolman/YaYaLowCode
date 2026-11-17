import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return proxyBackendJson(request, `/api/market/application-submissions/${encodeURIComponent((await params).id)}/retry`, "POST", 120_000); }
