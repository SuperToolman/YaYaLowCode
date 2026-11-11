import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutomationsPageClient } from "./AutomationsPageClient";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/shared/providers/ThemeProvider", () => ({
  useTheme: () => ({ appearance: { surfaceVariant: "default" } }),
}));
vi.mock("@/shared/lib/notify", () => ({
  notify: { error: mocks.error, success: mocks.success }, notifyRequestError: vi.fn(),
}));
vi.mock("@/features/automation-editor/api", () => ({
  listAutomationFlows: vi.fn(async () => ({ data: { code: 0, message: "ok", data: {
    items: [
      { id: "process", name: "审批流程", flowType: "process", status: "enabled", triggerLabel: "表单提交时", nodesCount: 2 },
      { id: "manual", name: "转意向客户", flowType: "trigger", status: "paused", triggerEvents: ["button_click"], triggerLabel: "按钮触发", nodesCount: 1 },
    ], total: 2, enabled: 1, paused: 1,
  } } })),
  listForms: vi.fn(async () => ({ data: { code: 0, message: "ok", data: [{ id: "form", name: "客户" }] } })),
  deleteAutomationFlow: mocks.remove,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("disables process selection and excludes it from select all", async () => {
  render(<AutomationsPageClient appId="APP_A" />);
  const process = await screen.findByRole("checkbox", { name: /选择 审批流程/ });
  expect((process as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择当前页全部自动化" }));
  expect(await screen.findByText("已选 1 条")).toBeTruthy();
  expect((process as HTMLInputElement).checked).toBe(false);
});

it("shows the backend failure message with the automation name", async () => {
  mocks.remove.mockResolvedValue({ error: { code: 400, message: "具体删除失败原因", data: null }, response: new Response(null, { status: 400 }) });
  render(<AutomationsPageClient appId="APP_A" />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /选择 转意向客户/ }));
  fireEvent.click(await screen.findByRole("button", { name: "删除所选" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(
    "批量删除完成：成功 0 条，失败 1 条。",
    { description: "转意向客户：具体删除失败原因" },
  ));
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  expect(screen.getByText("已选 1 条")).toBeTruthy();
});

it("removes a deleted automation from the list and preserves process automations", async () => {
  mocks.remove.mockResolvedValue({ data: { code: 0, message: "删除成功", data: { deleted: true } } });
  render(<AutomationsPageClient appId="APP_A" />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /选择 转意向客户/ }));
  fireEvent.click(await screen.findByRole("button", { name: "删除所选" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("已删除 1 条集成自动化"));
  expect(screen.queryByRole("checkbox", { name: /选择 转意向客户/ })).toBeNull();
  expect(screen.getByRole("checkbox", { name: /选择 审批流程/ })).toBeTruthy();
});
