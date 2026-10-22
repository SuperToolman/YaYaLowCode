import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithControl, requestApi } from "./api-request";
import { SYSTEM_FAILURE_EVENT, type SystemFailureKind } from "./system-notification";
import { listApps } from "./http";

describe("system request notifications", () => {
  const events: SystemFailureKind[] = [];
  const listener = (event: Event) => events.push((event as CustomEvent<SystemFailureKind>).detail);

  beforeEach(() => {
    events.length = 0;
    window.addEventListener(SYSTEM_FAILURE_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(SYSTEM_FAILURE_EVENT, listener);
    vi.unstubAllGlobals();
  });

  it("reports server and authentication failures from the shared transport", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await fetchWithControl("/api/test");
    await fetchWithControl("/api/test");
    expect(events).toEqual(["server", "auth"]);
  });

  it("does not treat a login 401 as an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await fetchWithControl("/api/auth/login", { suppressAuthNotification: true });
    expect(events).toEqual([]);
  });

  it("keeps business failures local and reports invalid responses", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 400, message: "业务校验失败", data: null }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(Response.json({})));
    await expect(requestApi("/api/test")).rejects.toThrow("业务校验失败");
    await expect(requestApi("/api/test")).rejects.toThrow("服务返回了无效响应");
    await expect(requestApi("/api/test")).rejects.toThrow("服务返回了无效响应");
    expect(events).toEqual(["invalid-response", "invalid-response"]);
  });

  it("reports network and timeout failures", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })));
    await expect(fetchWithControl("/api/test")).rejects.toMatchObject({ kind: "network" });
    await expect(fetchWithControl("/api/test", { timeoutMs: 1 })).rejects.toMatchObject({ kind: "timeout" });
    expect(events).toEqual(["network", "timeout"]);
  });

  it("does not report caller cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = fetchWithControl("/api/test", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
    expect(events).toEqual([]);
  });

  it("reports invalid JSON from the OpenAPI SDK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })));
    const result = await listApps({ baseUrl: "http://localhost" });
    expect(result.error).toMatchObject({ kind: "invalid-response", status: 200, cause: expect.any(SyntaxError) });
    expect(events).toEqual(["invalid-response"]);
  });
});
