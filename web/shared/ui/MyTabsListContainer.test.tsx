import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Tabs } from "@heroui/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MyTabsListContainer } from "./MyTabsListContainer";

const observers = new Map<Element, Set<() => void>>();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(private callback: () => void) {}
    observe(target: Element) {
      this.targets.add(target);
      const callbacks = observers.get(target) ?? new Set();
      callbacks.add(this.callback);
      observers.set(target, callbacks);
    }
    unobserve(target: Element) {
      observers.get(target)?.delete(this.callback);
      this.targets.delete(target);
    }
    disconnect() {
      for (const target of this.targets) this.unobserve(target);
    }
  });
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.unstubAllGlobals();
});

function ViewTabs({ names }: { names: string[] }) {
  return (
    <Tabs selectedKey="0">
      <MyTabsListContainer className="max-w-full">
        <Tabs.List aria-label="数据视图">
          {names.map((name, index) => (
            <Tabs.Tab key={index} id={String(index)}>
              {name}<Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </MyTabsListContainer>
    </Tabs>
  );
}

it("updates overflow after deleting, adding and renaming views inside an unchanged viewport", async () => {
  const view = render(<ViewTabs names={["全部数据", "自定义视图"]} />);
  const scroller = view.container.querySelector<HTMLElement>('[data-slot="scroll-shadow"]')!;
  const list = view.container.querySelector<HTMLElement>('[role="tablist"]')!;
  Object.defineProperties(scroller, {
    clientWidth: { get: () => 100 },
    scrollWidth: { get: () => (list.textContent?.length ?? 0) * 15 },
  });

  // Simulate the browser resizing the list, without resizing the viewport.
  const resizeContent = async () => {
    expect(observers.get(list)?.size).toBeGreaterThan(0);
    await act(async () => {
      for (const callback of observers.get(list) ?? []) callback();
    });
  };
  await resizeContent();
  await waitFor(() => expect(scroller.dataset.rightScroll).toBe("true"));

  await act(async () => view.rerender(<ViewTabs names={["全部数据"]} />));
  await resizeContent();
  await waitFor(() => expect(scroller.dataset.rightScroll).toBe("false"));
  expect(scroller.dataset.leftScroll).toBe("false");

  await act(async () => view.rerender(<ViewTabs names={["全部数据", "新增视图"]} />));
  await resizeContent();
  await waitFor(() => expect(scroller.dataset.rightScroll).toBe("true"));

  await act(async () => view.rerender(<ViewTabs names={["全部数据", "短"]} />));
  await resizeContent();
  await waitFor(() => expect(scroller.dataset.rightScroll).toBe("false"));

  view.unmount();
  expect(observers.get(list)?.size).toBe(0);
});
