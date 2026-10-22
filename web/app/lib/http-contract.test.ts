import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, fetchWithControl, openEventStream, requestApi, shouldRetryQuery, unwrapApiResult } from "./api-request";
import { downloadFile, listApps } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("JSON contract", () => {
  it.each([null, false, 0, "", [], {}])("accepts valid empty data %j", (data) => {
    expect(unwrapApiResult({ data: { code: 0, message: "ok", data } })).toEqual(data);
  });
  it("preserves business status and code", () => {
    expect(() => unwrapApiResult({ response: new Response(null, { status: 200 }), data: { code: 42, message: "quota", data: null } }))
      .toThrow(expect.objectContaining({ kind: "business", status: 200, code: 42, message: "quota" }));
  });
  it.each([400, 401, 403, 404, 500, 503])("preserves HTTP %i and backend details", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 123, data: null, message: "detail" }, { status })));
    await expect(requestApi("/api/example")).rejects.toMatchObject({ status, code: 123, kind: "http", message: "detail" });
  });
  it("handles 204 from both BFF and SDK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 }))));
    expect(await requestApi("/api/example")).toBeUndefined();
    expect(unwrapApiResult({ response: new Response(null, { status: 204 }) })).toBeUndefined();
  });
  it("preserves bodyless HEAD and 205 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 205 }))));
    expect((await fetchWithControl("/api/example", { bufferResponse: true })).status).toBe(205);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { headers: { "content-type": "application/json" } }))));
    expect(await (await fetchWithControl("/api/example", { method: "HEAD", bufferResponse: true })).text()).toBe("");
  });
  it("SDK errors keep their original cause and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad json", { headers: { "content-type": "application/json" } })));
    const result = await listApps({ baseUrl: "http://localhost" });
    expect(() => unwrapApiResult(result)).toThrow(expect.objectContaining({ kind: "invalid-response", status: 200, cause: expect.any(SyntaxError) }));
  });
});

describe("retry policy", () => {
  it.each(["network", "timeout", "http"] as const)("retries transient %s at most twice", (kind) => {
    const error = new ApiRequestError("failed", 503, kind);
    expect([0, 1, 2, 3].map(count => shouldRetryQuery(count, error))).toEqual([true, true, false, false]);
  });
  it("does not retry other failures", () => {
    for (const error of [new Error("unknown"), new ApiRequestError("auth", 401), new ApiRequestError("bad", 400), new ApiRequestError("business", 503, "business"), new ApiRequestError("cancel", 0, "aborted"), new ApiRequestError("invalid", 200, "invalid-response")]) {
      expect(shouldRetryQuery(0, error)).toBe(false);
    }
  });
});

describe("special transport", () => {
  it("does not unpack Blob downloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("binary", { headers: { "content-type": "application/octet-stream" } })));
    const result = await downloadFile({ baseUrl: "http://localhost", path: { fileId: "file" }, parseAs: "blob" });
    expect(result.data).toBeInstanceOf(Blob);
    expect(await (result.data as Blob).text()).toBe("binary");
  });
  it("stream deadline ends at connection headers", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("data: hello\n\n")); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })));
    const response = await openEventStream("/api/stream", { timeoutMs: 1 });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(await response.text()).toBe("data: hello\n\n");
  });
  it("applies the JSON deadline while the body is being read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_input, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({ start(controller) { init.signal?.addEventListener("abort", () => controller.error(new DOMException("abort", "AbortError"))); } }), { headers: { "content-type": "application/json" } }))));
    await expect(fetchWithControl("/api/slow", { timeoutMs: 5 })).rejects.toMatchObject({ kind: "timeout" });
  });
  it("retains caller cancellation after stream headers without AbortSignal.any", async () => {
    const originalAny = AbortSignal.any;
    Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
    try {
      const caller = new AbortController();
      vi.stubGlobal("fetch", vi.fn().mockImplementation((_input, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({ start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("abort", "AbortError")));
      } }), { headers: { "content-type": "text/event-stream" } }))));
      const response = await openEventStream("/api/stream", { signal: caller.signal });
      const body = response.text();
      caller.abort();
      await expect(body).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      Object.defineProperty(AbortSignal, "any", { value: originalAny, configurable: true });
    }
  });
});
