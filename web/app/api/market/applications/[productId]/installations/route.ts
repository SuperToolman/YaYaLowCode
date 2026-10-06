import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return proxyBackendJson(request, `/api/market/applications/${encodeURIComponent(productId)}/installations`);
}
