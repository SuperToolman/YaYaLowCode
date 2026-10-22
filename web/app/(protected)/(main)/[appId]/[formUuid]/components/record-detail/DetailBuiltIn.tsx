"use client";

export function DetailBuiltIn({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]" title={value}>{value}</div>
    </div>
  );
}

