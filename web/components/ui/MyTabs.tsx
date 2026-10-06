"use client";

import type { CSSProperties, KeyboardEvent } from "react";

export type MyTabItem<T extends string> = {
  label: string;
  value: T;
};

type MyTabsProps<T extends string> = {
  ariaLabel: string;
  className?: string;
  items: readonly MyTabItem<T>[];
  onValueChange: (value: T) => void;
  value: T;
};

/** Compact token-aware tabs for property panels and segmented choices. */
export function MyTabs<T extends string>({
  ariaLabel,
  className,
  items,
  onValueChange,
  value,
}: MyTabsProps<T>) {
  const selectRelative = (current: T, offset: number) => {
    const currentIndex = items.findIndex((item) => item.value === current);
    const nextIndex = (currentIndex + offset + items.length) % items.length;
    onValueChange(items[nextIndex].value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, item: T) => {
    if (!items.length) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectRelative(item, -1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectRelative(item, 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onValueChange(items[0].value);
    } else if (event.key === "End") {
      event.preventDefault();
      onValueChange(items.at(-1)!.value);
    }
  };

  return (
    <div
      aria-label={ariaLabel}
      className={[
        "grid min-h-7 w-full min-w-0 gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-0.5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      style={{
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      } as CSSProperties}
    >
      {items.map((item) => (
        <button
          key={item.value}
          aria-selected={value === item.value}
          className="min-w-0 overflow-hidden truncate whitespace-nowrap rounded-sm border-0 bg-transparent px-1 py-1 text-[10px] leading-none text-[var(--color-text-secondary)] outline-none transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] data-[selected=true]:bg-[var(--color-bg-surface)] data-[selected=true]:text-[var(--color-text-primary)] data-[selected=true]:shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-1"
          data-selected={value === item.value}
          onClick={() => onValueChange(item.value)}
          onKeyDown={(event) => onKeyDown(event, item.value)}
          role="tab"
          tabIndex={value === item.value ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
