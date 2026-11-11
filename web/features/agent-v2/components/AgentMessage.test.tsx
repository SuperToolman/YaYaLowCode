import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentMessage } from "./AgentMessage";

vi.mock("./AgentThinkBlock", () => ({ ThinkBlock: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("./AgentToolCallCard", () => ({ ToolCallCard: () => <div>工具卡片</div> }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("updates active elapsed time and freezes it after completion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
  const message = { id: "a", role: "assistant" as const, content: "", elapsedMs: 120000 };
  const view = render(<AgentMessage message={message} runStatus="working" />);
  expect(screen.getByText("已经处理2分钟（运行中）")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText("已经处理2分1秒（运行中）")).toBeTruthy();
  act(() => { vi.advanceTimersByTime(59000); });
  expect(screen.getByText("已经处理3分钟（运行中）")).toBeTruthy();
  view.rerender(<AgentMessage message={{ ...message, elapsedMs: 180000 }} runStatus="completed" />);
  act(() => { vi.advanceTimersByTime(60000); });
  expect(screen.getByText("用时3分钟（完成）")).toBeTruthy();
});

it.each([
  [0, "0秒"],
  [6000, "6秒"],
  [59999, "59秒"],
  [60000, "1分钟"],
  [135000, "2分15秒"],
  [3600000, "1小时"],
  [3800000, "1小时3分20秒"],
  [86400000, "24小时"],
])("formats %i milliseconds with whole hours, minutes and seconds", (elapsedMs, elapsed) => {
  render(<AgentMessage message={{ id: "a", role: "assistant", content: "", elapsedMs }} runStatus="completed" />);
  expect(screen.getByText(`用时${elapsed}（完成）`)).toBeTruthy();
});

it("renders employee identity, Markdown and timeline blocks in order", () => {
  render(<AgentMessage employeeName="BOM 助手" employeeAvatarUrl="/avatar.png" message={{
    id: "a", role: "assistant", content: "", elapsedMs: 60000, runStatus: "paused",
    timeline: [
      { id: "think", type: "reasoning", text: "检查物料" },
      { id: "tool", type: "tool", activity: { id: "c", name: "read", status: "completed" } },
      { id: "answer", type: "answer", text: "**整理完成**" },
    ],
  }} />);
  expect(screen.getByText("BOM 助手")).toBeTruthy();
  expect(screen.getByRole("img", { name: "BOM 助手的头像" }).textContent).toBe("B");
  expect(screen.getByText("整理完成").tagName).toBe("STRONG");
  expect(screen.getByText("检查物料").compareDocumentPosition(screen.getByText("工具卡片")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("工具卡片").compareDocumentPosition(screen.getByText("整理完成")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("你在1分钟后停止（暂停）")).toBeTruthy();
});

it("does not show employee identity or run status on user bubbles", () => {
  render(<AgentMessage employeeName="BOM 助手" runStatus="working" message={{ id: "u", role: "user", content: "你好" }} />);
  expect(screen.getByText("你")).toBeTruthy();
  expect(screen.queryByText("BOM 助手")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
