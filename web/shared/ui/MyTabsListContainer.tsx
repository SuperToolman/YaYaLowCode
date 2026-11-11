"use client";

import { Tabs } from "@heroui/react";
import { useEffect, useRef, type ComponentProps } from "react";

/** Recheck HeroUI's scroll controls when dynamic tab content changes size. */
export function MyTabsListContainer({
  children,
  ...props
}: Omit<ComponentProps<typeof Tabs.ListContainer>, "ref">) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const scroller = container?.querySelector<HTMLElement>('[data-slot="scroll-shadow"]');
    const list = scroller?.querySelector<HTMLElement>('[role="tablist"]');
    if (!scroller || !list) return;

    // HeroUI observes the viewport only. The content can shrink or grow while
    // that viewport stays the same size, leaving its overflow flags stale.
    const observer = new ResizeObserver(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  return (
    <Tabs.ListContainer {...props} ref={containerRef}>
      {children}
    </Tabs.ListContainer>
  );
}
