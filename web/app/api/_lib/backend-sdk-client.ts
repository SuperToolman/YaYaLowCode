import { NextResponse } from "next/server";

import { createClient } from "../../lib/api-client/client/client.gen";
import { backendAuthorizationHeaders } from "./backend-json-proxy";

const backendBaseUrl =
  process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

type SdkResult = {
  data?: unknown;
  error?: unknown;
  response?: Response;
};

export function createBackendSdkClient(request: Request) {
  return createClient({
    baseUrl: backendBaseUrl,
    headers: backendAuthorizationHeaders(request),
  });
}

export async function sdkJsonResponse(result: Promise<SdkResult>) {
  const resolved = await result;
  const status = resolved.response?.status ?? 502;
  const payload = resolved.data ?? resolved.error ?? {
    code: status,
    data: null,
    message: "backend unavailable",
  };
  return NextResponse.json(payload, { status });
}
