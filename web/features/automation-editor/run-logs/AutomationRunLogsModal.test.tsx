import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiAutomationRun, ApiAutomationRunNode } from "../api";
import { AutomationRunLogsModal } from "./AutomationRunLogsModal";
import { logDuration, orderRunNodes, sourceRecordId } from "./model";

vi.mock("@/shared/providers/ThemeProvider", () => ({ useTheme: () => ({ appearance: { surfaceVariant: "default" } }) }));
const node = (id: string, status: string, startedAt: string): ApiAutomationRunNode => ({
  id, nodeKey: id, nodeKind: "add-data", nodeLabel: id, status, startedAt,
  attempt: 1, input: { parent: "customer" }, output: { saved: id }, errorMessage: status === "failed" ? "写入失败" : null,
});
const run: ApiAutomationRun = {
  id: "run-1", flowVersion: 2, triggerEvent: "button_click", triggerPayload: { __automationRecordUuid: "record-1" },
  status: "failed", startedAt: "2026-10-27T01:00:00Z", durationMs: 2000, allowedActions: ["retry"],
  nodes: [node("后续新增", "failed", "2026-10-27T01:00:01Z"), node("新增客户", "success", "2026-10-27T01:00:00Z")],
};
function props(runs = [run]) {
  return { name: "转意向客户", runs, loading: false, retryingKey: null, onClose: vi.fn(), onRefresh: vi.fn(), onRetryRun: vi.fn(), onRetryNode: vi.fn(), onResolve: vi.fn() };
}
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps discovering executions when the list is empty or contains only finished runs", () => {
  const interval = vi.spyOn(window, "setInterval");
  const clear = vi.spyOn(window, "clearInterval");
  const callbacks = props([]);
  const view = render(<AutomationRunLogsModal {...callbacks} />);
  expect(interval).toHaveBeenCalledWith(callbacks.onRefresh, 3000);
  const tick = interval.mock.calls[0][0] as () => void;
  tick();
  expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  view.rerender(<AutomationRunLogsModal {...callbacks} runs={[run]} />);
  tick();
  expect(callbacks.onRefresh).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(clear).toHaveBeenCalled();
});

it("shows queued and running instances before completion", async () => {
  render(<AutomationRunLogsModal {...props([
    { ...run, id: "queued-run", status: "queued", nodes: [], finishedAt: null, durationMs: null },
    { ...run, id: "active-run", status: "running", finishedAt: null, durationMs: null },
  ])} />);
  expect(await screen.findByRole("button", { name: "查看实例 queued-run" })).toBeTruthy();
  expect(within(screen.getByRole("table")).getByText("排队中")).toBeTruthy();
  expect(within(screen.getByRole("table")).getByText("运行中")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看实例 active-run" }));
  expect(screen.getByRole("navigation", { name: "节点流转" })).toBeTruthy();
});

it("orders actual visits chronologically and handles missing metadata", () => {
  expect(orderRunNodes(run.nodes).map((n) => n.id)).toEqual(["新增客户", "后续新增"]);
  expect(run.nodes[0].id).toBe("后续新增");
  expect(sourceRecordId({ recordUuid: "source" }, run.triggerPayload)).toBe("source");
  expect(sourceRecordId(null, run.triggerPayload)).toBe("record-1");
  expect(sourceRecordId(null, null)).toBe("—");
  expect(logDuration(0)).toBe("0 ms");
  expect(logDuration(null)).toBe("—");
});

it("opens instance details, navigates visits and retains selection across refresh", async () => {
  const callbacks = props();
  const view = render(<AutomationRunLogsModal {...callbacks} />);
  expect(await screen.findByRole("table")).toBeTruthy();
  expect(screen.queryByText(/"parent"/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看实例 run-1" }));
  const nav = screen.getByRole("navigation", { name: "节点流转" });
  const visits = within(nav).getAllByRole("button");
  expect(visits[1].textContent).toContain("新增客户");
  expect(visits[2].textContent).toContain("后续新增");
  fireEvent.click(visits[2]);
  expect(screen.getByRole("region", { name: "错误数据" }).textContent).toContain("写入失败");
  fireEvent.click(screen.getByRole("button", { name: "从此节点重试" }));
  expect(callbacks.onRetryNode).toHaveBeenCalledWith("run-1", "后续新增");
  fireEvent.click(screen.getByRole("button", { name: "输出" }));
  expect(screen.getByRole("region", { name: "输出数据" }).textContent).toContain('"saved"');
  view.rerender(<AutomationRunLogsModal {...callbacks} runs={[{ ...run, nodes: run.nodes.map((n) => ({ ...n, output: { refreshed: true } })) }]} />);
  expect(screen.getByRole("region", { name: "输出数据" }).textContent).toContain('"refreshed": true');
  fireEvent.click(screen.getByRole("button", { name: "返回实例列表" }));
  expect(screen.getByRole("table")).toBeTruthy();
});

it("paginates and searches execution instances", async () => {
  render(<AutomationRunLogsModal {...props(Array.from({ length: 11 }, (_, i) => ({ ...run, id: `instance-${i}` })))} />);
  await screen.findByRole("table");
  expect(screen.getAllByRole("button", { name: /^查看实例/ })).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getAllByRole("button", { name: /^查看实例/ })).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索执行实例" }), { target: { value: "instance-3" } });
  expect(screen.getByRole("button", { name: "查看实例 instance-3" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^查看实例/ })).toHaveLength(1);
});

it("filters runs by status", async () => {
  render(<AutomationRunLogsModal {...props([run, { ...run, id: "successful", status: "success" }])} />);
  fireEvent.click(await screen.findByRole("button", { name: /执行状态/ }));
  fireEvent.click(await screen.findByRole("option", { name: "成功", selected: false }));
  expect(screen.getByRole("button", { name: "查看实例 successful" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "查看实例 run-1" })).toBeNull();
});
