import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Drawer, Tabs } from "@heroui/react";
import { tabsVariants } from "@heroui/styles";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
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

it("keeps retained tab slots isolated when another instance uses a different variant", () => {
  // HeroUI memoizes these slots per mounted Tabs instance.
  const page = tabsVariants({ variant: undefined });
  const drawer = tabsVariants({ variant: "secondary" });

  expect(drawer.base()).toContain("tabs--secondary");
  expect(page.base()).toBe("tabs");

  for (let cycle = 0; cycle < 3; cycle++) {
    tabsVariants({ variant: "primary" }).base();
    expect(drawer.base()).toContain("tabs--secondary");
    tabsVariants({ variant: "secondary" }).base();
    expect(page.base()).toBe("tabs");
  }
});

function ViewTabsWithSettings({ isOpen }: { isOpen: boolean }) {
  return (
    <>
      <Tabs selectedKey="all" data-testid="page-tabs">
        <Tabs.ListContainer>
          <Tabs.List aria-label="数据视图">
            <Tabs.Tab id="all">全部数据<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="custom">未命名表格视图<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={() => {}}>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.Heading>视图设置</Drawer.Heading>
            <Tabs variant="secondary" selectedKey="filters" data-testid="settings-tabs">
              <Tabs.ListContainer>
                <Tabs.List aria-label="视图设置分组">
                  <Tabs.Tab id="filters">筛选<Tabs.Indicator /></Tabs.Tab>
                  <Tabs.Tab id="sorts">排序<Tabs.Indicator /></Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}

it("preserves default page tabs after repeatedly opening and closing secondary tabs in a drawer", async () => {
  const view = render(<ViewTabsWithSettings isOpen={false} />);
  expect(screen.getByTestId("page-tabs").classList.contains("tabs--secondary")).toBe(false);

  for (let cycle = 0; cycle < 3; cycle++) {
    await act(async () => view.rerender(<ViewTabsWithSettings isOpen />));
    expect(screen.getByRole("dialog", { name: "视图设置" })).toBeTruthy();
    expect(screen.getByTestId("settings-tabs").classList.contains("tabs--secondary")).toBe(true);
    await act(async () => view.rerender(<ViewTabsWithSettings isOpen={false} />));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("page-tabs").classList.contains("tabs--secondary")).toBe(false);
  }
});
