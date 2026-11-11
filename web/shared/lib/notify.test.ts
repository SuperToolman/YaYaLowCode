import { beforeEach, describe, expect, it, vi } from "vitest";
const { danger, success } = vi.hoisted(() => ({ danger: vi.fn(), success: vi.fn() }));
vi.mock("@heroui/react", () => ({ toast: { danger, success } }));
import { notifyRequestError, notifySystemError } from "./notify";
import { ApiRequestError } from "./api-request";

beforeEach(() => vi.clearAllMocks());
describe("notification ownership", () => {
  it("deduplicates by category while keeping page business context", () => {
    notifySystemError("network"); notifySystemError("network"); notifySystemError("timeout");
    notifyRequestError(new ApiRequestError("quota", 200, "business", 42), "业务处理失败");
    expect(danger).toHaveBeenCalledTimes(3);
  });
  it("does not repeat system failures or cancellations on pages", () => {
    for (const error of [new ApiRequestError("network", 0, "network"), new ApiRequestError("auth", 401), new ApiRequestError("server", 503), new ApiRequestError("cancel", 0, "aborted")]) notifyRequestError(error, "请求失败");
    expect(danger).not.toHaveBeenCalled();
  });
});
