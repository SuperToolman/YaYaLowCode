import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { listAutomationFlows, type AutomationFlow } from "@/features/automation-editor/api";
import { FormEventsPanel } from "./FormEventsPanel";

vi.mock("@/features/automation-editor/api", () => ({
  listAutomationFlows: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function respond(items: Partial<AutomationFlow>[]) {
  vi.mocked(listAutomationFlows).mockResolvedValue({
    data: {
      code: 0,
      message: "ok",
      data: { items, total: items.length, enabled: 0, paused: 0 },
    },
  } as Awaited<ReturnType<typeof listAutomationFlows>>);
}

it("仅展示当前表单关联自动化，点击提供自动化原始名称", async () => {
  respond([
    {
      id: "one",
      name: "提交 & 通知",
      triggerFormUuid: "form",
      triggerLabel: "创建成功后",
      status: "enabled",
    },
    {
      id: "two",
      name: "其他表单事件",
      triggerFormUuid: "other",
      status: "paused",
    },
  ]);
  const open = vi.fn();
  render(<FormEventsPanel appId="app" formUuid="form" onOpen={open} />);
  fireEvent.click(await screen.findByRole("button", { name: /提交 & 通知/ }));
  expect(open).toHaveBeenCalledWith("提交 & 通知");
  expect(screen.queryByText("其他表单事件")).toBeNull();
  expect(screen.getByText(/创建成功后 · 已启动/)).toBeTruthy();
});

it("加载失败可重试，并展示空关联状态", async () => {
  vi.mocked(listAutomationFlows).mockRejectedValueOnce(new Error("offline"));
  render(<FormEventsPanel appId="app" formUuid="form" onOpen={vi.fn()} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  respond([]);
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(await screen.findByText("暂无关联的集成自动化")).toBeTruthy();
});
