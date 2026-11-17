import { afterEach, expect, it, vi } from "vitest";
import { exportApplicationPackage, submitAppToMarketplace } from "./api";

const mocks = vi.hoisted(() => ({ export: vi.fn(), submit: vi.fn() }));
vi.mock("@/shared/lib/http", () => ({ exportMarketPackage: mocks.export, submitMarketApplication: mocks.submit }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetAllMocks(); });

it("preserves backend export failure reasons instead of a generic download error", async () => {
  mocks.export.mockResolvedValue({ error: { message: "应用结构已变化，请重新预检" }, response: new Response(null, { status: 409 }) });
  await expect(exportApplicationPackage("a", "snapshot", "1.0.0")).rejects.toThrow("应用结构已变化，请重新预检");
});

it("returns a downloadable file receipt after initiating the browser download", async () => {
  const blob = new Blob(["zip-data"]);
  mocks.export.mockResolvedValue({ data: blob, response: new Response(null, { headers: { "content-disposition": "attachment; filename*=UTF-8''suite.zip" } }) });
  const create = vi.fn().mockReturnValue("blob:download");
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const receipt = await exportApplicationPackage("a", "snapshot", "1.0.0");
  expect(receipt).toEqual({ blob, filename: "suite.zip", size: blob.size });
  expect(create).toHaveBeenCalledWith(blob);
  expect(click).toHaveBeenCalledOnce();
});

it("allows packaging to exceed 15 seconds while retaining a bounded request timeout", async () => {
  vi.useFakeTimers();
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  mocks.submit.mockImplementation(async (options) => {
    const response = await options.fetch(new Request("http://localhost/submit"));
    return { data: await response.json(), response };
  });
  const pending = submitAppToMarketplace("a", {fingerprint:"snapshot",selectedAppIds:["a"],newProduct:true,commercial:{pricingMode:"free",priceCents:0,publisherRateBasisPoints:0,currency:"CNY",licenseModel:"one_time",description:"应用"}});
  const requestSignal = fetcher.mock.calls[0][1].signal as AbortSignal;
  await vi.advanceTimersByTimeAsync(16_000);
  expect(requestSignal.aborted).toBe(false);
  finish(Response.json({code:0,message:"ok",data:{submissionId:"sub-slow",status:"pending_review"}}));
  await expect(pending).resolves.toMatchObject({submissionId:"sub-slow"});
  expect(vi.getTimerCount()).toBe(0);
});
