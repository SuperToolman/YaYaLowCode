import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AboutPlatformClient from "./AboutPlatformClient";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ hasPermission: () => false }) }));
vi.mock("@/features/settings/components/LicenseManagementModal", () => ({ openLicenseManagementModal: vi.fn() }));
vi.mock("@/features/settings/api", () => ({
  getLicenseStatus: vi.fn(async () => null),
  getValkeyRuntimeStatus: vi.fn(async () => ({ status: "disabled", message: "未启用缓存" })),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("renders changelog source through the shared renderer without Agent cleanup and preserves refresh", async () => {
  render(<AboutPlatformClient changelog={{ version: "1.0", markdown: '# 更新记录\n\n- 保留重复项目\n- 保留重复项目\n\n```js\nconst x = 1;\n```' }} />);
  const region = screen.getByRole("region", { name: "更新日志内容" });
  expect(within(region).getAllByText("保留重复项目")).toHaveLength(2);
  expect(within(region).getByRole("link", { name: "链接到此标题" })).toBeTruthy();
  expect(within(region).getByRole("button", { name: "复制代码" })).toBeTruthy();
  expect(region.querySelector(".token.keyword")?.textContent).toBe("const");
  fireEvent.click(screen.getByRole("button", { name: "刷新日志" }));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByText("未启用缓存")).toBeTruthy());
});
