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
  const hideSidebar = /\/automations\/[^/]+$/.test(pathname);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        const nextWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, event.clientX),
        );
        setSidebarWidth(nextWidth);
      });
    };

    const onPointerUp = () => {
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
    <div className="flex min-h-screen gap-4 overflow-x-hidden p-2">
      {!hideSidebar ? (
        <div
          className="relative shrink-0 rounded-xl bg-white"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="h-full min-h-[calc(100vh-1rem)] overflow-hidden rounded-xl border border-[var(--line)] bg-white">
            {sidebar}
          </div>
          <div
            aria-label="调整表单导航宽度"
            role="separator"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={sidebarWidth}
            aria-orientation="vertical"
            onPointerDown={() => setDragging(true)}
            className={`absolute right-[-5px] top-0 h-full w-[10px] cursor-col-resize ${
              dragging ? "bg-[var(--brand-blue)]/10" : "bg-transparent"
            }`}
          >
            <span className="mx-auto block h-full w-[2px] bg-transparent transition-colors hover:bg-[var(--brand-blue)]/30" />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-[calc(100vh-1rem)] min-w-0 flex-1 flex-col gap-4">
        {children}
      </div>
    </div>
  );
}
