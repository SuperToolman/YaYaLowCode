/**
 * 字段属性布局
 * */

"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Button, Input, Switch } from "@heroui/react";
import { parseOptionalNumber } from "../../designer-options";
import { MySurface } from "@/components/ui/MySurface";

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
    <MySurface className="overflow-hidden rounded-md bg-[var(--designer-surface-muted)]">
      <div className="flex p-1 items-center justify-between bg-[var(--designer-surface-soft)] text-[12px]">
        <span className="text-[12px]">{title}</span>
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
    <Input
      aria-label="属性值"
      className="flex-1"
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(event.currentTarget.value)
      }
    />
  );
}

export function NumberWithActions({
  max,
  min,
  onChange,
  value,
}: {
  max?: number;
  min?: number;
  onChange: (value: number | undefined) => void;
  value?: number;
}) {
  return (
    <Input
      aria-label="数值属性"
      className="h-7 min-w-0 flex-1 text-[11px]"
      min={min}
      max={max}
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
    <Switch aria-label="开关" isSelected={isSelected} onChange={onChange}>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch>
  );
}

export function IconAction({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <Button isIconOnly size="sm" variant="ghost" aria-label={label}>
      {icon}
    </Button>
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
