/**
 * 字段属性布局
 * */

"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Input, Switch } from "@heroui/react";
import { parseOptionalNumber } from "../../designer-options";

export function PropertyPanel({ children }: { children: ReactNode }) {
  return <div className="space-y-2 px-2 pb-3">{children}</div>;
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
    <section className="border-t border-[#eef2f7]">
      <div className="flex h-9 items-center justify-between bg-[#fafbfd] px-2 text-sm font-semibold text-[#202f45]">
        <span>{title}</span>
        <span className="flex items-center gap-2 text-[#8d9aae]">
          {rightIcon}
          <ChevronIcon />
        </span>
      </div>
      <div className="space-y-2 px-2 py-2">{children}</div>
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
        "grid grid-cols-[76px_minmax(0,1fr)] gap-2 text-sm",
        align === "start" ? "items-start" : "items-center",
      ].join(" ")}
    >
      <div className="pt-1 text-[#202f45]">{label}</div>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
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
    <>
      <Input
        aria-label="属性值"
        className="min-w-0 flex-1"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.currentTarget.value)
        }
      />
      <IconAction label="国际化" icon={<GlobeIcon />} />
      <IconAction label="表达式" icon={<CodeToken />} />
    </>
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
    <>
      <Input
        aria-label="数值属性"
        className="min-w-0 flex-1"
        min={min}
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(parseOptionalNumber(event.currentTarget.value))
        }
      />
      <IconAction label="编辑" icon={<EditIcon />} />
    </>
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
    <Switch
      aria-label="开关"
      isSelected={isSelected}
      onChange={onChange}
      size="sm"
    >
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch>
  );
}

export function IconAction({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8d9aae] transition hover:bg-[#f2f5fa] hover:text-[#2f6bff]"
    >
      {icon}
    </button>
  );
}

export function CodeToken() {
  return <span className="font-mono text-xs">{"{}"}</span>;
}

function GlobeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9 9 0 1 0 0-18m0 18c2.2-2.3 3.4-5.3 3.4-9S14.2 5.3 12 3m0 18c-2.2-2.3-3.4-5.3-3.4-9S9.8 5.3 12 3M3.6 9h16.8M3.6 15h16.8"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.9 4.7 2.4 2.4M5 19h4l9.5-9.5a1.7 1.7 0 0 0 0-2.4L16.9 5.5a1.7 1.7 0 0 0-2.4 0L5 15v4Z"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m18 15-6-6-6 6" />
    </svg>
  );
}
