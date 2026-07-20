import { NextResponse } from "next/server";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { code: status, data: null, message, time: new Date().toISOString() },
    { status },
  );
}

export async function GET() {
  try {
    const response = await fetch(`${backendBaseUrl}/api/settings/identity-source`, { cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return errorResponse("backend unavailable", 503);
  }
}

export async function PUT(request: Request) {
  try {
    const response = await fetch(`${backendBaseUrl}/api/settings/identity-source`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return errorResponse("backend unavailable", 503);
  }
}
