import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { testModelRoute } from "@/features/settings/api";
import { ProviderConnectionTest } from "./ProviderConnectionTest";
import { notify, notifyRequestError } from "@/shared/lib/notify";

vi.mock("@/features/settings/api", () => ({ testModelRoute: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
  notifyRequestError: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const props = { id: "provider-1", apiBaseUrl: "https://api.siliconflow.cn/v1", apiKey: "", disabled: false };

it("tests the current configuration without saving and displays latency", async () => {
  vi.mocked(testModelRoute).mockResolvedValue({ success: true, message: "连接成功", latencyMs: 125, models: [] });
  render(<ProviderConnectionTest {...props} apiKey=" new-key " />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(notify.success).toHaveBeenCalledWith("连接测试成功", { description: "连接成功（125 ms）" }));
  expect(screen.queryByText("连接成功（125 ms）")).toBeNull();
  expect(testModelRoute).toHaveBeenCalledWith("provider-1", { providerKind: "", apiBaseUrl: props.apiBaseUrl, apiKey: "new-key" });
});

it("uses the saved key when empty and displays provider failures", async () => {
  vi.mocked(testModelRoute).mockResolvedValue({ success: false, message: "鉴权失败", latencyMs: 40, models: [] });
  render(<ProviderConnectionTest {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(notify.error).toHaveBeenCalledWith("连接测试失败", { description: "鉴权失败（40 ms）" }));
  expect(testModelRoute).toHaveBeenCalledWith("provider-1", { providerKind: "", apiBaseUrl: props.apiBaseUrl, apiKey: undefined });
});

it("does not show an old success after the configuration changes during testing", async () => {
  let finish!: (result: Awaited<ReturnType<typeof testModelRoute>>) => void;
  vi.mocked(testModelRoute).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<ProviderConnectionTest {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  expect(screen.getByRole("button", { name: "测试中…" }).hasAttribute("disabled")).toBe(true);
  view.rerender(<ProviderConnectionTest {...props} apiBaseUrl="https://another.example/v1" />);
  await act(async () => finish({ success: true, message: "连接成功", latencyMs: 20, models: [] }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(notify.success).not.toHaveBeenCalled();
  expect(notify.error).not.toHaveBeenCalled();
});

it("shows request errors and permits retrying", async () => {
  vi.mocked(testModelRoute).mockRejectedValue(new Error("连接超时"));
  render(<ProviderConnectionTest {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(notifyRequestError).toHaveBeenCalledWith(expect.any(Error), "连接测试失败", { description: "连接超时" }));
  expect(screen.getByRole("button", { name: "测试连接" }).hasAttribute("disabled")).toBe(false);
});
