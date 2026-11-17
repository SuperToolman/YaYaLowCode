import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getLicenseStatus } from "@/features/settings/api";
import { AuthenticatedAppShell } from "./AuthenticatedAppShell";

vi.mock("./HomeSideBar", () => ({ default: () => null }));
vi.mock("@/features/settings/api", () => ({ getLicenseStatus: vi.fn() }));
vi.mock("../../features/settings/components/LicenseManagementModal", () => ({
  OPEN_LICENSE_MANAGEMENT_MODAL_EVENT: "open-license",
  OPEN_LICENSE_UPDATE_PROMPT_EVENT: "open-update",
  LicenseManagementModal: ({ open }: { open: boolean }) => open ? <div>更新平台签名</div> : null,
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("身份校验失败显示读取错误，重试成功恢复页面，不误报许可证无效", async () => {
  vi.mocked(getLicenseStatus).mockRejectedValueOnce(new Error("运维会话已过期或撤销"));
  render(<AuthenticatedAppShell>实例业务内容</AuthenticatedAppShell>);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("运维会话已过期或撤销"));
  expect(screen.queryByText("更新平台签名")).toBeNull();
  vi.mocked(getLicenseStatus).mockResolvedValueOnce({ valid: true } as Awaited<ReturnType<typeof getLicenseStatus>>);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.queryByText("更新平台签名")).toBeNull();
});

it("只有成功读取且明确无效的许可证才打开更新签名窗口", async () => {
  vi.mocked(getLicenseStatus).mockResolvedValueOnce({ valid: false } as Awaited<ReturnType<typeof getLicenseStatus>>);
  render(<AuthenticatedAppShell>实例业务内容</AuthenticatedAppShell>);
  await waitFor(() => expect(screen.getByText("更新平台签名")).toBeTruthy());
  expect(screen.queryByRole("alert")).toBeNull();
});
