"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Card } from "@heroui/react";

import { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, useSidebarPreferences } from "@/features/application/sidebar-preferences";
const SIDEBAR_ENTER_STYLE = `@keyframes sidebar-enter { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }`;
import { AppShellContext } from "@/features/application/shell-context";
export { useAppHeaderActions, useAppShellSidebar } from "@/features/application/shell-context";

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { sidebarWidth, collapsed, setSidebarWidth, toggleCollapsed } = useSidebarPreferences();
  const [headerActionsTarget, setHeaderActionsTarget] =
    useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const pendingWidthRef = useRef(sidebarWidth);
  const hideSidebar =
    /\/automations(?:\/|$)/.test(pathname) ||
    /\/settings(?:\/|$)/.test(pathname);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(
          MIN_SIDEBAR_WIDTH,
          origin.startWidth + event.clientX - origin.startX,
        ),
      );
      pendingWidthRef.current = nextWidth;

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        sidebarRef.current?.style.setProperty(
          "width",
          `${pendingWidthRef.current}px`,
        );
        frameRef.current = null;
      });
    };

    const stopDragging = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setSidebarWidth(pendingWidthRef.current);
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
  }, [dragging, setSidebarWidth]);

  return (
    <AppShellContext.Provider
      value={{
        collapsed,
        toggleCollapsed,
        headerActionsTarget,
        setHeaderActionsTarget,
      }}
    >
      <>
        <style>{SIDEBAR_ENTER_STYLE}</style>
        <div
          className={`flex h-full min-h-0 ${hideSidebar ? "gap-0" : collapsed ? "gap-0" : "gap-2 sm:gap-4"} overflow-x-hidden ${dragging ? "select-none" : ""}`}
        >
          {!hideSidebar ? (
            <div
              ref={sidebarRef}
              className={`relative shrink-0 overflow-visible rounded-2xl transition-[width,opacity] duration-300 ease-in-out ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"}`}
              style={{ width: collapsed ? 0 : `${sidebarWidth}px` }}
            >
              {!collapsed ? (
                <div className="h-full animate-[sidebar-enter_300ms_ease-out]">
                  {sidebar}
                </div>
              ) : null}
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
                  dragOriginRef.current = {
                    startX: event.clientX,
                    startWidth: sidebarWidth,
                  };
                  pendingWidthRef.current = sidebarWidth;
                  setDragging(true);
                }}
                className={`absolute right-[-5px] top-0 h-full w-[10px] cursor-col-resize touch-none select-none transition-opacity duration-200 ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"} ${
                  dragging ? "bg-[var(--color-primary)]/10" : "bg-transparent"
                }`}
              >
                <span className="mx-auto block h-full w-[2px] bg-transparent transition-colors hover:bg-[var(--color-primary)]/30" />
              </div>
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {children}
          </div>
        </div>
      </>
    </AppShellContext.Provider>
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

  if (/\/settings(?:\/|$)/.test(pathname)) {
    return <div className="min-h-0 flex-1 overflow-hidden">{children}</div>;
  }

  return (
    <>
      <Card
        className={`min-h-0 flex-1 ${lockOuterScroll ? "overflow-hidden" : "overflow-auto"}`}
      >
        <Card.Content>{children}</Card.Content>
      </Card>
    </>
  );
}
