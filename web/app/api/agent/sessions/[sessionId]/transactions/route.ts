import { proxyAgentRuntimeJson } from "@/app/api/_lib/agent-runtime-proxy";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return proxyAgentRuntimeJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/transactions`);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return proxyAgentRuntimeJson(request, `/api/agent/sessions/${encodeURIComponent(sessionId)}/transactions`);
}
