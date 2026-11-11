import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentTimelineItem, AgentToolActivity } from "../types";
import { groupToolCalls, ToolCallGroup } from "./AgentToolCallGroup";

vi.mock("./AgentToolCallCard", () => ({ ToolCallCard: ({ activity, sessionId }: { activity: AgentToolActivity; sessionId?: string }) => <div>{activity.id}:{sessionId}</div> }));
afterEach(cleanup);
const call = (id: string, name: string): AgentTimelineItem => ({ id, type: "tool", activity: { id, name, status: "completed" } });

it("groups adjacent scripts across tool names, keeping category, text and reasoning boundaries", () => {
  const blocks: AgentTimelineItem[] = [
    call("a", "workspace_execute_code"), call("b", "skill_run_script"),
    { id: "answer", type: "answer", text: "继续" },
    call("c", "workspace_execute_code"), call("d", "skill_read_resource"), call("e", "workspace_read_file"),
    { id: "think", type: "reasoning", text: "思考" }, call("f", "workspace_read_file"),
  ];
  const grouped = groupToolCalls(blocks);
  expect(grouped.map(block => block.type === "calls" ? block.activities.map(activity => activity.id) : block.type)).toEqual([
    ["a", "b"], "answer", ["c"], ["d", "e"], "reasoning", ["f"],
  ]);
  expect(groupToolCalls(blocks)).toEqual(grouped);
  expect(blocks).toHaveLength(8);
});

it("collapses multiple calls by default and passes session identity to expanded details", () => {
  const activities: AgentToolActivity[] = ["a", "b"].map(id => ({ id, name: "workspace_execute_code", status: "completed" }));
  const view = render(<ToolCallGroup activities={activities} sessionId="session" />);
  const button = screen.getByRole("button", { name: /运行了脚本/ });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("a:session")).toBeNull();
  fireEvent.click(button);
  expect(screen.getByText("a:session")).toBeTruthy();
  expect(screen.getByText("b:session")).toBeTruthy();
  view.rerender(<ToolCallGroup activities={[...activities, { id: "c", name: "skill_run_script", status: "running" }]} sessionId="session" />);
  expect(screen.getByRole("button", { name: /正在运行脚本/ }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("3 次")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /正在运行脚本/ }));
  expect(screen.queryByText("a:session")).toBeNull();
});

it("keeps failures visible while collapsed and renders a single call without a group", () => {
  const activities: AgentToolActivity[] = [{ id: "a", name: "read", status: "completed" }, { id: "b", name: "list", status: "failed" }];
  const view = render(<ToolCallGroup activities={activities} />);
  expect(screen.getByRole("button", { name: /运行了工具/ })).toBeTruthy();
  expect(screen.getByText("有异常")).toBeTruthy();
  view.rerender(<ToolCallGroup activities={activities.slice(0, 1)} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("a:")).toBeTruthy();
});
