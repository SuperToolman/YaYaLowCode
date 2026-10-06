import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({
  Toast: { Provider: () => null },
  toast: {
    success: vi.fn(), danger: vi.fn(), warning: vi.fn(), info: vi.fn(),
  },
}));

import { toast } from "@heroui/react";
import { AppToastProvider } from "./AppToastProvider";
import { notify } from "@lib/notify";
import { reportSystemFailure } from "@lib/system-notification";

describe("AppToastProvider", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports unhandled runtime errors once and suppresses duplicate page errors after system failures", () => {
    const { unmount } = render(<AppToastProvider />);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("render failed") }));
    expect(toast.danger).toHaveBeenCalledWith("页面发生异常", expect.any(Object));

    reportSystemFailure("server");
    expect(toast.danger).toHaveBeenCalledWith("服务暂时不可用", expect.any(Object));
    const calls = vi.mocked(toast.danger).mock.calls.length;
    notify.error("页面请求失败");
    expect(toast.danger).toHaveBeenCalledTimes(calls);
    unmount();
  });
});
