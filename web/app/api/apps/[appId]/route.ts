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
  context: { params: Promise<{ appId: string }> },
) {
  const { appId } = await context.params;

  try {
    const response = await fetch(`${backendBaseUrl}/api/apps`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      code: number;
      data: Array<{ id: string }> | null;
      message: string;
      time: string;
    };
    const app = payload.data?.find((item) => item.id === appId) ?? null;

    if (!response.ok || payload.code !== 0) {
      return NextResponse.json(payload, { status: response.status });
    }

    if (!app) {
      return buildErrorResponse("app not found", 404);
    }

    return NextResponse.json({ ...payload, data: app });
  } catch {
    return buildErrorResponse("backend unavailable", 503);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ appId: string }> },
) {
  const { appId } = await context.params;

  try {
    const body = await request.text();
    const response = await fetch(`${backendBaseUrl}/api/apps/${appId}`, {
      method: "PATCH",
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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ appId: string }> },
) {
  const { appId } = await context.params;

  try {
    const response = await fetch(`${backendBaseUrl}/api/apps/${appId}`, {
      method: "DELETE",
      cache: "no-store",
    });
    const payload = await response.json();

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return buildErrorResponse("backend unavailable", 503);
  }
}
