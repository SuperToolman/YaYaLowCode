export type ApiEnvelope<T> = {
  code: number;
  data: T | null;
  message: string;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;

  if (!response.ok || payload?.code !== 0) {
    throw new ApiRequestError(
      payload?.message || `请求失败 (${response.status})`,
      response.status,
    );
  }

  return payload.data as T;
}

export function jsonRequest(body: unknown, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    body: JSON.stringify(body),
  };
}
