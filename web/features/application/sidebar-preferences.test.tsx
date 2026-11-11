import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarPreferences } from "./sidebar-preferences";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each([["10", 200], ["900", 350], ["invalid", 250]])(
  "restores width %s within the supported bounds",
  (saved, expected) => {
    localStorage.setItem("yaya-app-sidebar-width", saved);
    const { result } = renderHook(useSidebarPreferences);
    expect(result.current.sidebarWidth).toBe(expected);
  },
);

it("persists changes and updates other mounted consumers in the same tab", () => {
  const first = renderHook(useSidebarPreferences);
  const second = renderHook(useSidebarPreferences);
  act(() => {
    first.result.current.setSidebarWidth(300);
    first.result.current.toggleCollapsed();
  });
  expect(localStorage.getItem("yaya-app-sidebar-width")).toBe("300");
  expect(localStorage.getItem("yaya-app-sidebar-collapsed")).toBe("true");
  expect(second.result.current.sidebarWidth).toBe(300);
  expect(second.result.current.collapsed).toBe(true);
  act(() => second.result.current.toggleCollapsed());
  expect(first.result.current.collapsed).toBe(false);
});

it("responds to another tab changing or clearing storage", () => {
  const { result } = renderHook(useSidebarPreferences);
  act(() => {
    localStorage.setItem("yaya-app-sidebar-width", "320");
    window.dispatchEvent(new StorageEvent("storage", {
      key: "yaya-app-sidebar-width", storageArea: localStorage,
    }));
  });
  expect(result.current.sidebarWidth).toBe(320);
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
  });
  expect(result.current.sidebarWidth).toBe(250);
});

function Preferences() {
  const { sidebarWidth, collapsed } = useSidebarPreferences();
  return <output>{`${sidebarWidth}:${collapsed ? "collapsed" : "expanded"}`}</output>;
}

it("hydrates server defaults before restoring browser preferences without a mismatch", () => {
  localStorage.setItem("yaya-app-sidebar-width", "310");
  localStorage.setItem("yaya-app-sidebar-collapsed", "true");
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Preferences />);
  expect(container.textContent).toBe("250:expanded");
  document.body.appendChild(container);
  const onRecoverableError = vi.fn();
  render(<Preferences />, { container, hydrate: true, onRecoverableError });
  expect(screen.getByRole("status").textContent).toBe("310:collapsed");
  expect(onRecoverableError).not.toHaveBeenCalled();
});
