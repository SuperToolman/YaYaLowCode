import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformPackageModal } from "./PlatformPackageModal";

const mocks = vi.hoisted(() => ({ state: vi.fn(), start: vi.fn(), job: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("../platform-package-api", () => ({ getPlatformPackageState: mocks.state, startPlatformPackage: mocks.start, getPlatformPackageJob: mocks.job, checkPlatformPackageDownload: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { success: mocks.success, error: mocks.error }, notifyRequestError: mocks.error }));
const deployment = { webPort: 8787, apiPort: 8788, volumes: [{ key: "database", destination: "/var/lib/postgresql" }], environment: [{ name: "APP_ENV", required: true, default: "production" }, { name: "AUTH_TOKEN_SECRET", required: true }] };
const initial = { version: "1.13a", outputDirectory: "E:/dist/releases", ready: true, job: null, runtimeHash: "confirmed", deployment };
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("confirms version, deployment variables and architecture before starting a background job", async () => {
  mocks.state.mockResolvedValue(initial);
  mocks.start.mockResolvedValue({ id: "test-id", version: "1.13a", platform: "linux/arm64", status: "running", createdAt: new Date().toISOString(), message: "正在构建", logs: "building" });
  render(<PlatformPackageModal open onOpenChange={vi.fn()} />);
  await screen.findByText("AUTH_TOKEN_SECRET");
  expect(screen.getByText("部署时配置")).toBeTruthy();
  expect(screen.getByText("production")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "linux/arm64" }));
  fireEvent.click(screen.getByRole("button", { name: "确认打包" }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledWith("1.13a", "linux/arm64", "confirmed"));
  expect(await screen.findByText("正在构建")).toBeTruthy();
  expect(screen.getByRole("button", { name: "正在打包…" }).hasAttribute("disabled")).toBe(true);
});

it("shows an unavailable Docker environment and restores the existing job on reopen", async () => {
  mocks.state.mockResolvedValue({ ...initial, ready: false, reason: "Docker 未启动", job: { id: "previous", version: "1.13a", platform: "linux/amd64", status: "failed", createdAt: new Date().toISOString(), message: "离线打包失败", error: "Docker build failed", logs: "specific build error" } });
  const { rerender } = render(<PlatformPackageModal open={false} onOpenChange={vi.fn()} />);
  expect(mocks.state).not.toHaveBeenCalled();
  rerender(<PlatformPackageModal open onOpenChange={vi.fn()} />);
  expect(await screen.findByText("Docker 未启动")).toBeTruthy();
  expect(screen.getByText("specific build error")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重新打包" }).hasAttribute("disabled")).toBe(true);
  expect(mocks.start).not.toHaveBeenCalled();
});
