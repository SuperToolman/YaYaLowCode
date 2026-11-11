import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useExpandedGroups } from "./useExpandedGroups";

const key = (appId: string) => `yaya-app-navigation-expanded-groups:${appId}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("restores expanded and collapsed groups after remounting the sidebar", () => {
  window.localStorage.setItem(key("APP_A"), JSON.stringify({ first: true, second: false }));
  const first = renderHook(() => useExpandedGroups("APP_A"));
  expect(first.result.current[0]).toEqual({ first: true, second: false });
  act(() => first.result.current[1]((groups) => ({ ...groups, first: false, second: true })));
  first.unmount();
  const second = renderHook(() => useExpandedGroups("APP_A"));
  expect(second.result.current[0]).toEqual({ first: false, second: true });
});

it("keeps preferences isolated when switching applications", () => {
  window.localStorage.setItem(key("APP_A"), '{"group":true}');
  window.localStorage.setItem(key("APP_B"), '{"group":false}');
  const { result, rerender } = renderHook(({ appId }) => useExpandedGroups(appId), {
    initialProps: { appId: "APP_A" },
  });
  rerender({ appId: "APP_B" });
  expect(result.current[0]).toEqual({ group: false });
  expect(JSON.parse(window.localStorage.getItem(key("APP_A"))!)).toEqual({ group: true });
  rerender({ appId: "APP_A" });
  expect(result.current[0]).toEqual({ group: true });
});

it.each(["invalid json", "null", "[]", '{"valid":true,"invalid":"false"}'])(
  "handles invalid stored preferences: %s", (saved) => {
    window.localStorage.setItem(key("APP_A"), saved);
    const { result } = renderHook(() => useExpandedGroups("APP_A"));
    expect(result.current[0]).toEqual(saved.includes("valid") && saved.startsWith("{") ? { valid: true } : {});
  },
);

it("allows toggling when browser storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const { result } = renderHook(() => useExpandedGroups("APP_A"));
  act(() => result.current[1]({ group: true }));
  expect(result.current[0]).toEqual({ group: true });
});
