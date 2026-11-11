import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormViewTabs } from "@/features/records/screen/components/FormViewTabs";

beforeEach(() => {
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  delete (Element.prototype as Partial<Element>).getAnimations;
  vi.unstubAllGlobals();
});

const defaultView = { id: "default", name: "default", isDefault: true };
const customView = { id: "custom", name: "未命名表格视图", isDefault: false };

it("discards the old indicator and its geometry when views are added, renamed or deleted", async () => {
  const onActivate = vi.fn();
  const view = render(<FormViewTabs views={[defaultView]} activeViewId="default" onActivate={onActivate} />);
  let previousList = screen.getByRole("tablist");
  const indicator = previousList.querySelector<HTMLElement>('[data-slot="tabs-indicator"]')!;
  // A shared transition can retain these old measurements after the group moves.
  indicator.style.width = "88px";
  indicator.style.translate = "42px";

  for (const props of [
    { views: [defaultView, customView], activeViewId: "custom" },
    { views: [defaultView, { ...customView, name: "更长的自定义视图名称" }], activeViewId: "custom" },
    { views: [defaultView], activeViewId: "default" },
  ]) {
    await act(async () => view.rerender(<FormViewTabs {...props} onActivate={onActivate} />));
    const list = screen.getByRole("tablist");
    expect(list).not.toBe(previousList);
    expect(previousList.isConnected).toBe(false);
    const currentIndicator = list.querySelector<HTMLElement>('[data-slot="tabs-indicator"]')!;
    expect(currentIndicator.style.width).toBe("");
    expect(currentIndicator.style.translate).toBe("");
    previousList = list;
  }
  expect(screen.getAllByRole("tab")).toHaveLength(1);
});

it("preserves the animation scope during normal selection and activates tabs by stable view id", async () => {
  const onActivate = vi.fn();
  const views = [defaultView, customView];
  const view = render(<FormViewTabs views={views} activeViewId="default" onActivate={onActivate} />);
  const list = screen.getByRole("tablist");
  fireEvent.click(screen.getByRole("tab", { name: customView.name }));
  expect(onActivate).toHaveBeenCalledWith("custom");
  await act(async () => view.rerender(<FormViewTabs views={[...views]} activeViewId="custom" onActivate={onActivate} />));
  expect(screen.getByRole("tablist")).toBe(list);
  expect(screen.getByRole("tab", { name: customView.name }).getAttribute("aria-selected")).toBe("true");
});
