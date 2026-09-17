export type ApiEnvelope<T> = {
  code: number;
  data: T | null;
  message: string;
};

export type ApiErrorKind = "timeout" | "aborted" | "http" | "business" | "network" | "invalid-response";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: ApiErrorKind = "http",
    readonly code?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiRequestError";
  }
}

export function isRequestAborted(error: unknown): boolean {
  return (
    (error instanceof ApiRequestError && error.kind === "aborted") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

export type ApiRequestInit = RequestInit & { timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithControl(input: RequestInfo | URL, init: ApiRequestInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: initSignal, ...requestInit } = init;
  const signal = initSignal ?? (input instanceof Request ? input.signal : undefined);
  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => timeoutController.abort("timeout"), timeoutMs);

  // 兼容老版本浏览器，手动实现信号合并（AbortSignal.any 在 Chrome 116+ 才支持）
  let combinedSignal: AbortSignal;
  let externalAbortHandler: (() => void) | null = null;

  if (signal) {
    if (typeof AbortSignal.any === 'function') {
      // 现代浏览器直接使用 AbortSignal.any
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      // 老版本浏览器：监听外部信号，触发超时控制器
      combinedSignal = timeoutController.signal;
      if (!signal.aborted) {
        externalAbortHandler = () => timeoutController.abort(signal.reason);
        signal.addEventListener('abort', externalAbortHandler, { once: true });
      } else {
        timeoutController.abort(signal.reason);
      }
    }
  } else {
    combinedSignal = timeoutController.signal;
  }

  try {
    return await fetch(input, { ...requestInit, signal: combinedSignal });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new ApiRequestError(`请求超时 (${timeoutMs}ms)`, 0, "timeout", undefined, { cause: error });
    }
    if (combinedSignal.aborted) {
      throw new ApiRequestError("请求已取消", 0, "aborted", undefined, { cause: error });
    }
    throw new ApiRequestError("网络请求失败", 0, "network", undefined, { cause: error });
  } finally {
    if (externalAbortHandler && signal) {
      signal.removeEventListener('abort', externalAbortHandler);
    }
    globalThis.clearTimeout(timeoutId);
  }
}

export const controlledFetch: typeof fetch = (input, init) => fetchWithControl(input, init);

export async function requestApi<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<T> {
  const response = await fetchWithControl(path, init);
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;

  if (!response.ok) {
    throw new ApiRequestError(
      payload?.message || `请求失败 (${response.status})`,
      response.status,
      "http",
      payload?.code,
    );
  }
  if (!payload) throw new ApiRequestError("服务返回了无效响应", response.status, "invalid-response");
  if (payload.code !== 0) throw new ApiRequestError(payload.message || "业务请求失败", response.status, "business", payload.code);

  return payload.data as T;
}

export type EventStreamResponse = Response & { body: ReadableStream<Uint8Array> };

export async function openEventStream(path: string, init: ApiRequestInit = {}): Promise<EventStreamResponse> {
  const response = await fetchWithControl(path, { ...init, timeoutMs: init.timeoutMs ?? 20_000 });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as ApiEnvelope<never> | null;
    throw new ApiRequestError(payload?.message || `流式请求失败 (${response.status})`, response.status, "http", payload?.code);
  }
  return response as EventStreamResponse;
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
