"use client";

import type { ReactNode } from "react";
import { MySurface } from "@/shared/ui/MySurface";

export function PropertyPanelHeader({
  title,
  description,
}: {
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <div className="shrink-0 text-xs">
      <h2 className="truncate">{title}</h2>
      <div className="truncate text-[var(--color-text-secondary)]">
        {description}
      </div>
    </div>
  );
}

export function PropertySection({
  children,
  rightIcon,
  title,
}: {
  children: ReactNode;
  rightIcon?: ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between gap-1 text-xs text-[var(--color-text-secondary)]">
        <span>{title}</span>
        {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

export function PropertyGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <MySurface className="shrink-0 overflow-hidden rounded-md bg-[var(--designer-surface-muted)]">
      <div className="flex items-center justify-between bg-[var(--designer-surface-soft)] p-1 text-xs">
        <span className="text-xs">{title}</span>
      </div>
      <div className="space-y-1 p-1">{children}</div>
    </MySurface>
  );
}

export function PropertyRow({
  align = "center",
  children,
  label,
}: {
  align?: "center" | "start";
  children: ReactNode;
  label: ReactNode;
}) {
  return (
    <div
      className={[
        "grid grid-cols-[56px_minmax(0,1fr)] gap-1 text-xs",
        align === "start" ? "items-start" : "items-center",
      ].join(" ")}
    >
      <div className="flex items-center text-[var(--color-text-secondary)]">
        {label}
      </div>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}
