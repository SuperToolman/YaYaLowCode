import { NextResponse } from "next/server";

export const agentRuntimeBaseUrl = process.env.AGENT_RUNTIME_BASE_URL?.replace(/\/$/, "");

function authorizationHeaders(request: Request): Record<string, string> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)yaya-auth-token=([^;]+)/)?.[1];
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function proxyAgentRuntimeJson(request: Request, path: string) {
  if (!agentRuntimeBaseUrl) {
    return NextResponse.json({ code: 503, data: null, message: "agent runtime is not configured" }, { status: 503 });
  }
  try {
    const method = request.method;
    const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const body = hasBody ? await request.text() : undefined;
    const response = await fetch(`${agentRuntimeBaseUrl}${path}`, {
      method,
      headers: { ...(body?.trim() ? { "content-type": "application/json" } : {}), ...authorizationHeaders(request) },
      body: body?.trim() ? body : undefined,
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "agent runtime unavailable" }, { status: 503 });
  }
}

export async function proxyAgentRuntimeStream(request: Request, path: string) {
  if (!agentRuntimeBaseUrl) {
    return NextResponse.json({ code: 503, data: null, message: "agent runtime is not configured" }, { status: 503 });
  }
  try {
    const response = await fetch(`${agentRuntimeBaseUrl}${path}`, {
      method: request.method,
      headers: { "content-type": "application/json", accept: "text/event-stream", ...authorizationHeaders(request) },
      body: await request.text(),
      cache: "no-store",
    });
    if (!response.body) return NextResponse.json({ code: 502, data: null, message: "empty agent stream" }, { status: 502 });
    return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "agent runtime unavailable" }, { status: 503 });
  }
}
