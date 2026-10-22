import { reportSystemFailure } from "./system-notification";

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

export type ApiResult<T> = {
  data?: { code: number; message: string; data?: T | null };
  error?: unknown;
  response?: Response;
};

export function normalizeApiError(error: unknown, response?: Response): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  const status = response?.status ?? 0;
  const payload = typeof error === "object" && error !== null ? error : {};
  const message = "message" in payload && typeof payload.message === "string" ? payload.message : "请求失败";
  const code = "code" in payload && typeof payload.code === "number" ? payload.code : undefined;
  const kind: ApiErrorKind = isRequestAborted(error) ? "aborted"
    : response && !response.ok ? "http"
    : error instanceof SyntaxError ? "invalid-response" : "network";
  if (kind === "invalid-response") reportSystemFailure("invalid-response");
  return new ApiRequestError(kind === "invalid-response" ? "服务返回了无效响应" : message, status, kind, code, { cause: error });
}

/** Only JSON business envelopes enter this function; Blob and streams stay raw. */
export function unwrapApiResult<T>(result: ApiResult<T>, fallback = "请求失败"): T {
  const status = result.response?.status ?? 0;
  if (result.error !== undefined) throw normalizeApiError(result.error, result.response);
  if (result.response && !result.response.ok) throw normalizeApiError(result.data, result.response);
  if (status === 204) return undefined as T;
  const envelope = result.data;
  if (!envelope || typeof envelope.code !== "number" || typeof envelope.message !== "string") {
    reportSystemFailure("invalid-response");
    throw new ApiRequestError("服务返回了无效响应", status, "invalid-response");
  }
  if (envelope.code !== 0) throw new ApiRequestError(envelope.message || fallback, status, "business", envelope.code, { cause: envelope });
  if (!("data" in envelope)) {
    reportSystemFailure("invalid-response");
    throw new ApiRequestError("服务返回了无效响应", status, "invalid-response");
  }
  return envelope.data as T;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && error instanceof ApiRequestError && (
    error.kind === "network" || error.kind === "timeout" || (error.kind === "http" && error.status >= 500)
  );
}

/** Compatibility for pages that also display the backend success message. */
export function assertApiEnvelope<T>(
  data: ApiResult<T>["data"], error: unknown, response?: Response,
): asserts data is { code: number; message: string; data: T } {
  unwrapApiResult({ data, error, response });
}

export function assertApiResult<T>(result: ApiResult<T>): asserts result is ApiResult<T> & { data: { code: number; message: string; data: T } } {
  unwrapApiResult(result);
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

export function isSystemRequestError(error: unknown): boolean {
  return error instanceof ApiRequestError && (
    error.kind === "network" || error.kind === "timeout" || error.kind === "invalid-response" ||
    (error.kind === "http" && error.status >= 500)
  );
}

export type ApiRequestInit = RequestInit & { timeoutMs?: number; suppressAuthNotification?: boolean; bufferResponse?: boolean };

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithControl(input: RequestInfo | URL, init: ApiRequestInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, suppressAuthNotification = false, bufferResponse, signal: initSignal, ...requestInit } = init;
  const signal = initSignal ?? (input instanceof Request ? input.signal : undefined);
  const timeoutController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => timeoutController.abort("timeout"), timeoutMs);

  // 兼容老版本浏览器，手动实现信号合并（AbortSignal.any 在 Chrome 116+ 才支持）
  let combinedSignal: AbortSignal;
  let externalAbortHandler: (() => void) | null = null;
  let streamOwnsCleanup = false;
  const cleanupAbort = () => {
    if (externalAbortHandler && signal) signal.removeEventListener("abort", externalAbortHandler);
  };

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
    const response = await fetch(input, { ...requestInit, signal: combinedSignal });
    if (response.status === 401 && !suppressAuthNotification) reportSystemFailure("auth");
    else if (response.status >= 500) reportSystemFailure("server");
    // Keep the JSON deadline active while reading its body; streams end the
    // deadline at headers and continue under the caller cancellation signal.
    const method = requestInit.method ?? (input instanceof Request ? input.method : "GET");
    if (response.status !== 204 && response.status !== 205 && method !== "HEAD" && (bufferResponse ?? response.headers.get("content-type")?.includes("application/json"))) {
      const body = await response.arrayBuffer();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    // Without AbortSignal.any, retain caller cancellation until the stream ends.
    if (externalAbortHandler && response.body) {
      const reader = response.body.getReader();
      streamOwnsCleanup = true;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { cleanupAbort(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { cleanupAbort(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { cleanupAbort(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  } catch (error) {
    if (signal?.aborted) {
      throw new ApiRequestError("请求已取消", 0, "aborted", undefined, { cause: error });
    }
    if (timeoutController.signal.aborted) {
      reportSystemFailure("timeout");
      throw new ApiRequestError(`请求超时 (${timeoutMs}ms)`, 0, "timeout", undefined, { cause: error });
    }
    if (combinedSignal.aborted) {
      throw new ApiRequestError("请求已取消", 0, "aborted", undefined, { cause: error });
    }
    reportSystemFailure("network");
    throw new ApiRequestError("网络请求失败", 0, "network", undefined, { cause: error });
  } finally {
    if (!streamOwnsCleanup) cleanupAbort();
    globalThis.clearTimeout(timeoutId);
  }
}

export const controlledFetch: typeof fetch = (input, init) => fetchWithControl(input, init);

export async function requestApi<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<T> {
  const response = await fetchWithControl(path, { ...init, bufferResponse: true });
  if (response.status === 204) return undefined as T;
  let payload: ApiEnvelope<T> | undefined;
  try { payload = await response.json(); }
  catch (error) { throw normalizeApiError(error, response); }
  return unwrapApiResult({ data: payload, response }, "业务请求失败");
}

export type EventStreamResponse = Response & { body: ReadableStream<Uint8Array> };

export async function openEventStream(path: string, init: ApiRequestInit = {}): Promise<EventStreamResponse> {
  const response = await fetchWithControl(path, { ...init, bufferResponse: false, timeoutMs: init.timeoutMs ?? 20_000 });
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
