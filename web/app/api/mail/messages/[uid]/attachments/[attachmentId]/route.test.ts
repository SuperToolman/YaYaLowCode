import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const context = { params: Promise.resolve({ uid: "123", attachmentId: "0" }) };
const request = () => new Request("http://localhost/api/mail/messages/123/attachments/0?folder=inbox&uidValidity=7", { headers: { cookie: "yaya-auth-token=token" } });
afterEach(() => vi.unstubAllGlobals());

it("forwards authenticated binary downloads without JSON conversion", async () => {
  const bytes = new Uint8Array([0, 255, 127, 4]);
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { headers: { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=report.pdf" } }));
  vi.stubGlobal("fetch", fetcher);
  const response = await GET(request(), context);
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/mail/messages/123/attachments/0?folder=inbox&uidValidity=7"), expect.objectContaining({ headers: { authorization: "Bearer token" }, cache: "no-store" }));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("content-disposition")).toBe("attachment; filename=report.pdf");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("preserves backend errors and handles connection failures", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ code: 400, message: "附件不存在" }, { status: 400 })).mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  const missing = await GET(request(), context);
  expect(missing.status).toBe(400);
  expect((await missing.json()).message).toBe("附件不存在");
  const offline = await GET(request(), context);
  expect(offline.status).toBe(503);
  expect((await offline.json()).message).toBe("附件下载服务暂时不可用");
});
