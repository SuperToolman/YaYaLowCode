import { NextResponse } from "next/server";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

export async function GET() {
  try {
    const response = await fetch(`${backendBaseUrl}/api/identity/roles`, { cache: "no-store" });
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ code: 503, data: null, message: "backend unavailable" }, { status: 503 });
  }
}
