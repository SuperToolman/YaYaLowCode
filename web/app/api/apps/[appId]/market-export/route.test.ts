import { afterEach, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllGlobals());
const context = { params: Promise.resolve({ appId: "app-a" }) };
function request() { return new Request("http://localhost/api/apps/app-a/market-export", { method: "POST", headers: { cookie: "yaya-auth-token=session", "content-type": "application/json" }, body: JSON.stringify({ fingerprint: "snapshot", version: "1.0.0" }) }); }

it("forwards the confirmed fingerprint and authenticated ZIP download intact", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const disposition = "attachment; filename=application.zip; filename*=UTF-8''application.zip";
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": "application/zip", "content-disposition": disposition } }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(request(), context);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toContain("/api/apps/app-a/market-export");
  expect(init.method).toBe("POST"); expect(new Headers(init.headers).get("authorization")).toBe("Bearer session");
  expect(JSON.parse(new TextDecoder().decode(init.body))).toEqual({ fingerprint: "snapshot", version: "1.0.0" });
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("content-disposition")).toBe(disposition);
});

it("preserves snapshot conflicts for the export dialog", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 409, data: null, message: "请重新预检" }, { status: 409 })));
  const response = await POST(request(), context);
  expect(response.status).toBe(409); expect((await response.json()).message).toBe("请重新预检");
});
