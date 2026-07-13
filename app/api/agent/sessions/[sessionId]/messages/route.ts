import { NextResponse } from "next/server";

const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { code: status, data: null, message, time: new Date().toISOString() },
    { status },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const response = await fetch(
      `${backendBaseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
      { cache: "no-store" },
    );
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return errorResponse("backend unavailable", 503);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const response = await fetch(
      `${backendBaseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: await request.text(),
        cache: "no-store",
      },
    );
    if (!response.ok || !response.body) {
      return NextResponse.json(await response.json(), { status: response.status });
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch {
    return errorResponse("backend unavailable", 503);
  }
}
