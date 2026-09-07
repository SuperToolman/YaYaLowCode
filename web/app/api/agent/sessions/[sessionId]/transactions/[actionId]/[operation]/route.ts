import { proxyAgentRuntimeJson } from "@/app/api/_lib/agent-runtime-proxy";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string; actionId: string; operation: string }> }) {
  const { sessionId, actionId, operation } = await params;
  if (operation !== "execute" && operation !== "cancel") return new Response("Not found", { status: 404 });
  return proxyAgentRuntimeJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/transactions/${encodeURIComponent(actionId)}/${operation}`);
}
