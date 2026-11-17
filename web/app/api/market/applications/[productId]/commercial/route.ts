import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";
async function proxy(request: Request, { params }: { params: Promise<{ productId: string }> }) { const { productId } = await params; return proxyBackendJson(request, `/api/market/applications/${encodeURIComponent(productId)}/commercial`); }
export { proxy as GET, proxy as POST };
