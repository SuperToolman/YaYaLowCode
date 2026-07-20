/**
 * 字段属性布局
 * */

"use client";

import type { ChangeEvent, ReactNode } from "react";
import { parseOptionalNumber } from "../../designer-options";

export function PropertyPanel({ children }: { children: ReactNode }) {
  return <div className="space-y-1 p-1">{children}</div>;
}

export function PropertyFold({
  children,
  rightIcon,
  title,
}: {
  children: ReactNode;
  rightIcon?: ReactNode;
  title: string;
}) {
  return (
    <section className="m-1 overflow-hidden rounded-md border border-[var(--designer-border)] bg-[var(--designer-surface-muted)]">
      <div className="flex h-7 items-center justify-between border-b border-[var(--designer-border)] bg-[var(--designer-surface-soft)] px-1 text-[11px] font-medium text-[var(--color-text-primary)]">
        <span>{title}</span>
        <span className="flex items-center gap-1 text-[var(--color-text-disabled)]">
          {rightIcon}
          <ChevronIcon />
        </span>
      </div>
      <div className="space-y-1 p-1">{children}</div>
    </section>
  );
}

export function PropertyRow({
  align = "center",
  children,
  label,
}: {
  align?: "center" | "start";
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      className={[
        "grid grid-cols-[56px_minmax(0,1fr)] gap-1 text-[11px]",
        align === "start" ? "items-start" : "items-center",
      ].join(" ")}
    >
      <div className="pt-1 text-[var(--color-text-secondary)]">{label}</div>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}

export function TextWithActions({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <input
      aria-label="属性值"
      className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--designer-border)] bg-[var(--color-bg-input)] px-1.5 text-[11px] text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary-soft)]"
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(event.currentTarget.value)
      }
    />
  );
}

export function NumberWithActions({
  min,
  onChange,
  value,
}: {
  min?: number;
  onChange: (value: number | undefined) => void;
  value?: number;
}) {
  return (
    <input
      aria-label="数值属性"
      className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--designer-border)] bg-[var(--color-bg-input)] px-1.5 text-[11px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary-soft)]"
      min={min}
      type="number"
      value={typeof value === "number" ? String(value) : ""}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(parseOptionalNumber(event.currentTarget.value))
      }
    />
  );
}

export function PanelSwitch({
  isSelected,
  onChange,
}: {
  isSelected: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label="开关"
      aria-checked={isSelected}
      onClick={() => onChange(!isSelected)}
      className={`relative h-5 w-9 rounded-full border transition ${
        isSelected
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
          : "border-[var(--designer-border)] bg-[var(--color-bg-subtle)]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-[var(--color-control-thumb)] shadow-sm transition ${
          isSelected ? "left-[19px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function IconAction({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-primary)]"
    >
      {icon}
    </button>
  );
}

export function CodeToken() {
  return <span className="font-mono text-[10px]">{"{}"}</span>;
}


function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m18 15-6-6-6 6" />
    </svg>
  );
}
