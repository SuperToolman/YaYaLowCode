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
  request: Request,
  context: { params: Promise<{ formUuid: string }> },
) {
  const { formUuid } = await context.params;
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  const targetUrl = search
    ? `${backendBaseUrl}/api/forms/${formUuid}/schema?${search}`
    : `${backendBaseUrl}/api/forms/${formUuid}/schema`;

  try {
    const response = await fetch(targetUrl, {
      cache: "no-store",
    });
    const payload = await response.json();

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return buildErrorResponse("backend unavailable", 503);
  }
}
