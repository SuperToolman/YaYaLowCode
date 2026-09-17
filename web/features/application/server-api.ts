import { controlledFetch, type ApiEnvelope } from "@lib/api-request";

function backendUrl(path: string) {
  const baseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8788";
  return `${baseUrl}${path}`;
}

export async function getRuntimeApp<T>(appId: string): Promise<T | null> {
  const response = await controlledFetch(backendUrl(`/api/apps/${encodeURIComponent(appId)}`), { cache: "no-store" });
  const payload = await response.json() as ApiEnvelope<T>;
  return response.ok && payload.code === 0 ? payload.data : null;
}

export async function getRuntimeAppNavigation<T>(appId: string): Promise<T | null> {
  const response = await controlledFetch(backendUrl(`/api/apps/${encodeURIComponent(appId)}/navigation`), { cache: "no-store" });
  const payload = await response.json() as ApiEnvelope<T>;
  return response.ok && payload.code === 0 ? payload.data : null;
}
