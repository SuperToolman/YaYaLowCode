// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendSdkClient, sdkJsonResponse } from "./backend-sdk-client";
import { backendAuthorizationHeaders, proxyBackendJson } from "./backend-json-proxy";
import { listApps } from "../../lib/http";

afterEach(() => vi.unstubAllGlobals());
describe("backend forwarding", () => {
  it("keeps concurrent user credentials isolated", async () => {
    const tokens: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (request: Request) => {
      tokens.push(request.headers.get("authorization") ?? "");
      await Promise.resolve();
      return Response.json({ code: 0, message: "ok", data: [] });
    }));
    const clientA = createBackendSdkClient(new Request("http://localhost", { headers: { cookie: "yaya-auth-token=alice" } }));
    const clientB = createBackendSdkClient(new Request("http://localhost", { headers: { cookie: "yaya-auth-token=bob" } }));
    await Promise.all([listApps({ client: clientA }), listApps({ client: clientB })]);
    expect(tokens.sort()).toEqual(["Bearer alice", "Bearer bob"]);
  });
  it("prefers explicit Bearer credentials", () => {
    expect(backendAuthorizationHeaders(new Request("http://localhost", { headers: { authorization: "Bearer direct", cookie: "yaya-auth-token=cookie" } }))).toEqual({ authorization: "Bearer direct" });
  });
  it("preserves 204", async () => {
    expect((await sdkJsonResponse(Promise.resolve({ response: new Response(null, { status: 204 }) }))).status).toBe(204);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const response = await proxyBackendJson(new Request("http://localhost"), "/api/example");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
  it("reports invalid and unavailable backend responses consistently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not JSON")).mockRejectedValueOnce(new TypeError("offline")));
    expect((await proxyBackendJson(new Request("http://localhost"), "/api/example")).status).toBe(502);
    expect((await proxyBackendJson(new Request("http://localhost"), "/api/example")).status).toBe(503);
    expect((await sdkJsonResponse(Promise.reject(new TypeError("offline")))).status).toBe(503);
  });
  it("preserves backend HTTP errors rather than serializing Error objects", async () => {
    const response = await sdkJsonResponse(Promise.resolve({ error: { code: 99, message: "forbidden", data: null }, response: new Response(null, { status: 403 }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 99, message: "forbidden" });
  });
});
