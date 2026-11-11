import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentConversationLayout } from "./AgentConversationLayout";

let resize: ResizeObserverCallback;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  render(<AgentConversationLayout workspace={<div>工作区文件</div>}><div>消息与输入框</div></AgentConversationLayout>);
  const handle = screen.getByRole("separator", { name: "调整工作区宽度" });
  Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  return handle;
}

it("shares one Card and bounds keyboard resizing to preserve the message pane", () => {
  const handle = setup();
  expect(document.querySelectorAll(".card")).toHaveLength(1);
  expect(screen.getByText("工作区文件")).toBeTruthy();
  expect(screen.getByText("消息与输入框")).toBeTruthy();
  expect(handle.getAttribute("aria-valuenow")).toBe("280");
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle.getAttribute("aria-valuenow")).toBe("296");
  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle.getAttribute("aria-valuenow")).toBe("220");
  act(() => { resize([{ contentRect: { width: 768 } } as ResizeObserverEntry], {} as ResizeObserver); });
  fireEvent.keyDown(handle, { key: "End" });
  expect(handle.getAttribute("aria-valuenow")).toBe("400");
  act(() => { resize([{ contentRect: { width: 720 } } as ResizeObserverEntry], {} as ResizeObserver); });
  expect(handle.getAttribute("aria-valuenow")).toBe("352");
});

it("resizes by pointer drag, stops on cancellation and resets on double click", () => {
  const handle = setup();
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800, button: 0 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
  expect(handle.getAttribute("aria-valuenow")).toBe("380");
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 });
  expect(handle.getAttribute("aria-valuenow")).toBe("480");
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 });
  expect(handle.getAttribute("aria-valuenow")).toBe("480");
  fireEvent.doubleClick(handle);
  expect(handle.getAttribute("aria-valuenow")).toBe("280");
});

it("shows the session title and toggles the workspace without losing its resized width", () => {
  const view = render(<AgentConversationLayout title="帮我整理 BOM" workspace={<div>工作区文件</div>}><div>消息</div></AgentConversationLayout>);
  expect(screen.getByRole("heading", { name: "帮我整理 BOM" })).toBeTruthy();
  const toggle = screen.getByRole("button", { name: "收起会话工作区" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("complementary", { name: "会话工作区面板" }).id).toBe(toggle.getAttribute("aria-controls"));
  fireEvent.keyDown(screen.getByRole("separator", { name: "调整工作区宽度" }), { key: "ArrowLeft" });
  fireEvent.click(toggle);
  expect(screen.queryByRole("complementary", { name: "会话工作区面板" })).toBeNull();
  expect(screen.queryByRole("separator", { name: "调整工作区宽度" })).toBeNull();
  expect(screen.getByRole("button", { name: "展开会话工作区" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("消息")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "展开会话工作区" }));
  expect(screen.getByRole("complementary", { name: "会话工作区面板" })).toBeTruthy();
  expect(screen.getByRole("separator", { name: "调整工作区宽度" }).getAttribute("aria-valuenow")).toBe("296");
  view.rerender(<AgentConversationLayout title="已更新的标题" workspace={<div>工作区文件</div>}><div>消息</div></AgentConversationLayout>);
  expect(screen.getByRole("heading", { name: "已更新的标题" })).toBeTruthy();
});
