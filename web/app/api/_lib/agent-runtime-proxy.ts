import { NextResponse } from "next/server";

// Keep local development usable even when Next was started outside start-dev.ps1.
// Production must provide an explicit runtime URL.
export const agentRuntimeBaseUrl = (process.env.AGENT_RUNTIME_BASE_URL ||
  (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:8789" : ""))?.replace(/\/$/, "");

function authorizationHeaders(request: Request): Record<string, string> {
  const direct = request.headers.get("authorization")?.trim();
  if (direct?.toLowerCase().startsWith("bearer ")) return { authorization: direct };
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("yaya-auth-token="))
    ?.slice("yaya-auth-token=".length);
  if (!token) return {};
  try { return { authorization: `Bearer ${decodeURIComponent(token)}` }; } catch { return { authorization: `Bearer ${token}` }; }
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
      headers: { ...(body?.trim() ? { "content-type": "application/json" } : {}), ...authorizationHeaders(request), ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}) },
      body: body?.trim() ? body : undefined,
      cache: "no-store",
    });
    const text = await response.text();
    if (!text.trim()) {
      if (response.status === 204) {
        return NextResponse.json({ code: 0, data: {}, message: "request completed" }, { status: 200 });
      }
      return NextResponse.json(
        { code: response.ok ? 0 : response.status, data: null, message: response.ok ? "agent runtime returned an empty response" : `agent runtime returned HTTP ${response.status}` },
        { status: response.ok ? 502 : response.status },
      );
    }
    let payload: unknown;
    try { payload = JSON.parse(text); } catch {
      return NextResponse.json({ code: 502, data: null, message: "agent runtime returned invalid JSON" }, { status: 502 });
    }
    return NextResponse.json(payload, { status: response.status });
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
      headers: { "content-type": "application/json", accept: "text/event-stream", ...authorizationHeaders(request), ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie") as string } : {}) },
      body: await request.text(),
      cache: "no-store",
    });
    if (!response.body) return NextResponse.json({ code: 502, data: null, message: "empty agent stream" }, { status: 502 });
    return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "agent runtime unavailable" }, { status: 503 });
  }
}
