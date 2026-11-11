import { createClient } from "./api-client/client/client.gen";
import { fetchWithControl } from "./api-request";
import { backendAuthorizationHeaders } from "./backend-authorization";
const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8788";

export function createBackendSdkClient(request: Request) {
  const client = createClient({
    baseUrl: backendBaseUrl,
    headers: backendAuthorizationHeaders(request),
    fetch: (input, init) => fetchWithControl(input, { ...init, signal: request.signal }),
  });
  return client;
}

