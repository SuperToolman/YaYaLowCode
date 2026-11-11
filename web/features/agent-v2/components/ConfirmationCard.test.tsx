import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Confirmation } from "../client";
import { ConfirmationCard } from "./ConfirmationCard";

vi.mock("@/shared/providers/ThemeProvider", () => ({
  useTheme: () => ({ appearance: { surfaceVariant: "default" } }),
}));
afterEach(cleanup);
const confirmation = (): Confirmation => ({
  id: "c",
  session_id: "s",
  run_id: "r",
  call_id: "call",
  tool_name: "platform_delete_app",
  status: "pending",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  preview: {
    version: 1,
    title: "删除应用",
    resource: { name: "测试应用", id: "app-1" },
    changes: [],
    impacts: [{ label: "主记录", count: 12, description: "包含回收记录" }],
    warnings: ["此操作不能通过 Agent 撤销"],
  },
});

it("renders the exact resource and impact and submits only the decision", () => {
  const decide = vi.fn();
  render(
    <ConfirmationCard confirmation={confirmation()} onDecision={decide} />,
  );
  expect(screen.getByText("测试应用")).toBeTruthy();
  expect(screen.getByText(/主记录：12/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  expect(decide).toHaveBeenCalledExactlyOnceWith(true);
});

it("disables expired approval and restores a committed result from the database DTO", () => {
  const expired = {
    ...confirmation(),
    expires_at: new Date(Date.now() - 1000).toISOString(),
  };
  const { rerender } = render(
    <ConfirmationCard confirmation={expired} onDecision={vi.fn()} />,
  );
  expect(
    (screen.getByRole("button", { name: "确认执行" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <ConfirmationCard
      confirmation={{
        ...expired,
        status: "executed",
        result: { appId: "app-1", deleted: true },
      }}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
  expect(
    screen.getByRole("region", { name: "执行结果" }).textContent,
  ).toContain('"deleted": true');
});

it("shows frozen design properties, layout and baseline version after refresh", () => {
  const item = confirmation();
  item.tool_name = "platform_apply_design_patch";
  item.preview = {
    version: 1,
    title: "保存表单设计",
    resource: { id: "form", name: "工作流表单" },
    designBaseline: {
      algorithm: "sha256-json-v1",
      baseVersion: 2,
      baseHash: "base-sha",
      targetHash: "target-sha",
    },
    changes: [
      {
        label: "字段 金额",
        before: { colSpan: 1, props: { minValue: 0 } },
        after: { colSpan: 3, props: { minValue: 20 } },
      },
    ],
  };
  const decide = vi.fn();
  const { rerender } = render(
    <ConfirmationCard confirmation={item} onDecision={decide} />,
  );
  expect(
    screen.getByRole("region", { name: "设计基准" }).textContent,
  ).toContain("基于设计版本 2");
  expect(screen.getByText(/"minValue":20/).textContent).toContain(
    '"colSpan":3',
  );
  fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
  expect(decide).toHaveBeenCalledExactlyOnceWith(false);
  for (const status of ["rejected", "conflict", "cancelled"]) {
    rerender(
      <ConfirmationCard
        confirmation={{ ...item, status }}
        onDecision={decide}
      />,
    );
    expect(screen.queryByRole("button", { name: "确认执行" })).toBeNull();
  }
  expect(decide).toHaveBeenCalledTimes(1);
});
