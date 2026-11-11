"use client";

import { useSyncExternalStore } from "react";

export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 350;
const DEFAULT_SIDEBAR_WIDTH = 250;
const WIDTH_KEY = "yaya-app-sidebar-width";
const COLLAPSED_KEY = "yaya-app-sidebar-collapsed";
const CHANGE_EVENT = "yaya-app-sidebar-preferences-changed";

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage &&
      (event.key === null || event.key === WIDTH_KEY || event.key === COLLAPSED_KEY)) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function clampWidth(width: number) {
  return Number.isFinite(width)
    ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
    : DEFAULT_SIDEBAR_WIDTH;
}

function getWidth() {
  return clampWidth(Number.parseInt(window.localStorage.getItem(WIDTH_KEY) ?? "", 10));
}

function getCollapsed() {
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

function setSidebarWidth(width: number) {
  window.localStorage.setItem(WIDTH_KEY, String(clampWidth(width)));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function toggleCollapsed() {
  window.localStorage.setItem(COLLAPSED_KEY, String(!getCollapsed()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Server snapshots keep hydration stable; storage subscriptions restore browser preferences. */
export function useSidebarPreferences() {
  const sidebarWidth = useSyncExternalStore(subscribe, getWidth, () => DEFAULT_SIDEBAR_WIDTH);
  const collapsed = useSyncExternalStore(subscribe, getCollapsed, () => false);
  return { sidebarWidth, collapsed, setSidebarWidth, toggleCollapsed };
}
