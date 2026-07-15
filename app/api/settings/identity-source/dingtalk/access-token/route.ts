import { NextResponse } from "next/server";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

export async function POST() {
  try {
    const response = await fetch(
      `${backendBaseUrl}/api/settings/identity-source/dingtalk/access-token`,
      { method: "POST", cache: "no-store" },
    );
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { code: 503, data: null, message: "backend unavailable", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}
