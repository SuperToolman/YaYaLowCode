import { NextResponse } from "next/server";
import { backendAuthorizationHeaders } from "../../_lib/backend-json-proxy";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8788";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${backendBaseUrl}/api/files/upload`, {
      method: "POST",
      headers: backendAuthorizationHeaders(request),
      body: await request.formData(),
      cache: "no-store",
    });
    const responseText = await response.text();
    if (!responseText.trim()) return new NextResponse(null, { status: response.status });
    try {
      return NextResponse.json(JSON.parse(responseText), { status: response.status });
    } catch {
      return NextResponse.json({ code: 502, data: null, message: "backend returned invalid JSON" }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "backend unavailable" }, { status: 503 });
  }
}
