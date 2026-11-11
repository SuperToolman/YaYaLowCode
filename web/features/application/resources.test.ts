import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAppResourceCache, getAppForms, getAppNavigation } from "./resources";
import { notifyAppNavigationChanged } from "@/features/application/navigation-events";

const { listAppNavigation, listForms } = vi.hoisted(() => ({
  listAppNavigation: vi.fn(),
  listForms: vi.fn(),
}));
vi.mock("../../shared/lib/http", () => ({ listAppNavigation, listForms, listApps: vi.fn() }));

const response = (data: unknown) => ({ data: { code: 0, message: "ok", data } });

beforeEach(() => {
  vi.resetAllMocks();
  clearAppResourceCache();
});

describe("app navigation cache invalidation", () => {
  it("clears both lists before notifying mounted or remounting consumers", async () => {
    listForms.mockResolvedValueOnce(response([{ id: "form", name: "旧名称" }]))
      .mockResolvedValueOnce(response([{ id: "form", name: "新名称" }]));
    listAppNavigation.mockResolvedValueOnce(response([{ id: "nav", title: "旧名称" }]))
      .mockResolvedValueOnce(response([{ id: "nav", title: "新名称" }]));
    await Promise.all([getAppForms("app"), getAppNavigation("app")]);

    notifyAppNavigationChanged("app");

    expect(await getAppForms("app")).toEqual([{ id: "form", name: "新名称" }]);
    expect(await getAppNavigation("app")).toEqual([{ id: "nav", title: "新名称" }]);
    expect(listAppNavigation).toHaveBeenLastCalledWith(expect.objectContaining({ cache: "no-store" }));
  });

  it("does not evict a newer cache entry when an outdated request fails", async () => {
    let rejectOld!: (error: Error) => void;
    listAppNavigation.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce(response([]));
    const old = getAppNavigation("app");
    const rejected = expect(old).rejects.toThrow("old request");
    const fresh = getAppNavigation("app", true);
    await fresh;
    rejectOld(new Error("old request"));
    await rejected;

    expect(getAppNavigation("app")).toBe(fresh);
    expect(listAppNavigation).toHaveBeenCalledTimes(2);
  });
});
