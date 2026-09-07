"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Card } from "@heroui/react";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 350;
const DEFAULT_SIDEBAR_WIDTH = 250;
const SIDEBAR_WIDTH_STORAGE_KEY = "yaya-app-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "yaya-app-sidebar-collapsed";
const AppShellContext = createContext<{ collapsed: boolean; toggleCollapsed: () => void } | null>(null);
export function useAppShellSidebar() { const context = useContext(AppShellContext); if (!context) throw new Error("useAppShellSidebar must be used within AppShell"); return context; }

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const pendingWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const hideSidebar =
    /\/automations\/[^/]+$/.test(pathname) || /\/settings(?:\/|$)/.test(pathname);
  useEffect(() => { const width = Number.parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "", 10); if (Number.isFinite(width)) setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))); setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"); }, []);
  function toggleCollapsed() { setCollapsed((current) => { const next = !current; window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next)); return next; }); }

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, origin.startWidth + event.clientX - origin.startX),
      );
      pendingWidthRef.current = nextWidth;

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        sidebarRef.current?.style.setProperty("width", `${pendingWidthRef.current}px`);
        frameRef.current = null;
      });
    };

    const stopDragging = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setSidebarWidth(pendingWidthRef.current);
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(pendingWidthRef.current));
      dragOriginRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [dragging]);

  return (
    <AppShellContext.Provider value={{ collapsed, toggleCollapsed }}><div className={`flex h-full min-h-0 ${collapsed || hideSidebar ? "gap-0" : "gap-2 sm:gap-4"} overflow-x-hidden ${dragging ? "select-none" : ""}`}>
      {!hideSidebar && !collapsed ? (
        <div
          ref={sidebarRef}
          className="relative shrink-0 rounded-2xl"
          style={{ width: `${sidebarWidth}px` }}
        >
          {sidebar}
          <div
            aria-label="调整表单导航宽度"
            role="separator"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={sidebarWidth}
            aria-orientation="vertical"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragOriginRef.current = { startX: event.clientX, startWidth: sidebarWidth };
              pendingWidthRef.current = sidebarWidth;
              setDragging(true);
            }}
            className={`absolute right-[-5px] top-0 h-full w-[10px] cursor-col-resize touch-none select-none ${dragging ? "bg-[var(--color-primary)]/10" : "bg-transparent"
              }`}
          >
            <span className="mx-auto block h-full w-[2px] bg-transparent transition-colors hover:bg-[var(--color-primary)]/30" />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {children}
      </div>
    </div></AppShellContext.Provider>
  );
}

export function AppMainContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const isFormPage =
    segments.length === 2 &&
    segments[1] !== "automations" &&
    segments[1] !== "settings";
  const isAutomationList = /\/automations$/.test(pathname);
  const isAutomationEditor = /\/automations\/[^/]+$/.test(pathname);
  const lockOuterScroll = isFormPage || isAutomationList || isAutomationEditor;

  return (
    <>
      <Card className={`min-h-0 flex-1 ${lockOuterScroll ? "overflow-hidden" : "overflow-auto"}`} >
        <Card.Content>
          {children}
        </Card.Content>
      </Card >
    </>
  );
}
