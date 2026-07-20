import type { InputHTMLAttributes, ReactNode } from "react";
import { Input } from "@heroui/react";

type SearchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  action?: ReactNode;
};

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-5 w-5 text-[var(--color-text-secondary)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m13 13 4 4" />
    </svg>
  );
}

export function Search({
  className = "",
  placeholder = "请输入",
  action,
  ...props
}: SearchProps) {
  return (
    <div
      className={[
        "flex h-12 w-full items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 shadow-[var(--shadow-sm)]",
        className,
      ].join(" ")}
    >
      <SearchIcon />
      <Input
        className="flex-1"
        placeholder={placeholder}
        {...props}
      />
      {action}
    </div>
  );
}
