import { proxyBackendJson } from "@/app/api/_lib/backend-json-proxy";
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return proxyBackendJson(request, `/api/market/application-orders/${encodeURIComponent(orderId)}/simulate-payment`);
}
