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

async function buildProxyResponse(response: Response) {
  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return {
            code: response.status,
            data: null,
            message: text,
            time: new Date().toISOString(),
          };
        }
      })()
    : {
        code: response.status,
        data: null,
        message:
          response.status === 404
            ? "automation retry route unavailable, restart backend service"
            : "empty backend response",
        time: new Date().toISOString(),
      };

  return NextResponse.json(payload, { status: response.status });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ automationId: string; runId: string }> },
) {
  const { automationId, runId } = await context.params;

  try {
    const response = await fetch(
      `${backendBaseUrl}/api/automations/${automationId}/runs/${runId}/retry`,
      {
        method: "POST",
        cache: "no-store",
      },
    );
    return buildProxyResponse(response);
  } catch {
    return buildErrorResponse("backend unavailable", 503);
  }
}
