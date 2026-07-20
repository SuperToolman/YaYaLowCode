import { NextResponse } from "next/server";

const backendBaseUrl =
  process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

function buildErrorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      code: status,
      data: null,
      message,
      time: new Date().toISOString(),
    },
    { status },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ formUuid: string }> },
) {
  const { formUuid } = await context.params;

  try {
    const response = await fetch(`${backendBaseUrl}/api/forms/${formUuid}/records`, {
      cache: "no-store",
    });
    const payload = await response.json();

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return buildErrorResponse("backend unavailable", 503);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ formUuid: string }> },
) {
  const { formUuid } = await context.params;

  try {
    const body = await request.text();
    const response = await fetch(`${backendBaseUrl}/api/forms/${formUuid}/records`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: body || "{}",
      cache: "no-store",
    });
    const payload = await response.json();

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return buildErrorResponse("backend unavailable", 503);
  }
}
