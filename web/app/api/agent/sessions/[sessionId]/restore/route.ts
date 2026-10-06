import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return proxyBackendJson(request, `/api/agent/sessions/${encodeURIComponent((await params).sessionId)}/restore`);
}
