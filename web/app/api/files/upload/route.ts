import { NextResponse } from "next/server";
import { backendAuthorizationHeaders } from "../../_lib/backend-json-proxy";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${backendBaseUrl}/api/files/upload`, {
      method: "POST",
      headers: backendAuthorizationHeaders(request),
      body: await request.formData(),
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "backend unavailable" }, { status: 503 });
  }
}
