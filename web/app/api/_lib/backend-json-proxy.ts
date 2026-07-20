import { NextResponse } from "next/server";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

export async function proxyBackendJson(
  request: Request,
  path: string,
  method = request.method,
) {
  try {
    const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const response = await fetch(`${backendBaseUrl}${path}`, {
      method,
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? await request.text() : undefined,
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
