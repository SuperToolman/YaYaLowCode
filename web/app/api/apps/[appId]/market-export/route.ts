import { proxyBackendFile } from "@/app/api/_lib/backend-json-proxy";

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
  return proxyBackendFile(request, `/api/apps/${encodeURIComponent((await params).appId)}/market-export`);
}
