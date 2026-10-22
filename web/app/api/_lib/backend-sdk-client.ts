import { NextResponse } from "next/server";
import { ApiRequestError } from "../../lib/api-request";

export { createBackendSdkClient } from "../../lib/backend-client";


type SdkResult = {
  data?: unknown;
  error?: unknown;
  response?: Response;
};

export async function sdkJsonResponse(result: Promise<SdkResult>) {
  const resolved = await result.catch((error: unknown): SdkResult => ({ error }));
  const status = resolved.error instanceof Error && resolved.response?.ok ? 502 : resolved.response?.status ?? 503;
  if (status === 204) return new NextResponse(null, { status });
  const payload = resolved.data ?? (resolved.error instanceof Error ? undefined : resolved.error) ?? {
    code: resolved.error instanceof ApiRequestError ? resolved.error.code ?? status : status,
    data: null,
    message: resolved.error instanceof ApiRequestError && resolved.response ? resolved.error.message : "backend unavailable",
  };
  return NextResponse.json(payload, { status });
}
