import { NextResponse } from "next/server";

export const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

export function backendAuthorizationHeaders(
  request: Request,
): Record<string, string> {
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)yaya-auth-token=([^;]+)/)?.[1];
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function proxyBackendJson(
  request: Request,
  path: string,
  method = request.method,
) {
  try {
    const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const body = hasBody ? await request.text() : undefined;
    const hasJsonBody = Boolean(body?.trim());
    const response = await fetch(`${backendBaseUrl}${path}`, {
      method,
      headers: {
        ...(hasJsonBody ? { "content-type": "application/json" } : {}),
        ...backendAuthorizationHeaders(request),
      },
      body: hasJsonBody ? body : undefined,
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json(
      { code: 503, data: null, message: "backend unavailable", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}

export async function proxyBackendStream(
  request: Request,
  path: string,
  method = request.method,
) {
  try {
    const response = await fetch(`${backendBaseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...backendAuthorizationHeaders(request),
      },
      body: await request.text(),
      cache: "no-store",
    });
    if (!response.body) {
      return NextResponse.json(
        { code: 502, data: null, message: "backend returned an empty stream" },
        { status: 502 },
      );
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json(
      { code: 503, data: null, message: "backend unavailable", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}
