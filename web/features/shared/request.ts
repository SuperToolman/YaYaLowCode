import { controlledFetch, type ApiRequestInit } from "@lib/api-request";

/**
 * Shared transport for browser-side endpoints that are intentionally outside
 * the OpenAPI SDK (uploads, runtime proxies, and temporarily uncovered APIs).
 */
export function apiFetch(input: RequestInfo | URL, init?: ApiRequestInit) {
  return controlledFetch(input, init);
}
