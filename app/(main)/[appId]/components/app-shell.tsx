"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 350;
const DEFAULT_SIDEBAR_WIDTH = 250;

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const pendingWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const hideSidebar =
    /\/automations\/[^/]+$/.test(pathname) || pathname.endsWith("/settings");

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, event.clientX),
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

    const onPointerUp = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setSidebarWidth(pendingWidthRef.current);
      setDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [dragging]);

  return (
    <div className="flex h-full min-h-0 gap-2 overflow-x-hidden sm:gap-4 py-2 pr-2">
      {!hideSidebar ? (
        <div
          ref={sidebarRef}
          className="relative shrink-0 rounded-2xl will-change-[width]"
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
            onPointerDown={() => {
              pendingWidthRef.current = sidebarWidth;
              setDragging(true);
            }}
            className={`absolute right-[-5px] top-0 h-full w-[10px] cursor-col-resize ${
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
  );
}

export function AppMainContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const isFormPage =
    segments.length === 2 &&
    segments[1] !== "automations" &&
    segments[1] !== "settings";
  const isAutomationEditor = /\/automations\/[^/]+$/.test(pathname);
  const lockOuterScroll = isFormPage || isAutomationEditor;

  return (
    <main
      className={`min-h-0 flex-1 ${lockOuterScroll ? "overflow-hidden" : "overflow-auto"}`}
    >
      {children}
    </main>
  );
}
