"use client";

import { useEffect, useRef } from "react";

export function DetailBuiltIn({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]" title={value}>{value}</div>
    </div>
  );
}

export function TableSelectionCheckbox({
  ariaLabel,
  isSelected,
  isIndeterminate = false,
  onChange,
  className,
}: {
  ariaLabel: string;
  isSelected: boolean;
  isIndeterminate?: boolean;
  onChange: (selected: boolean) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  return (
    <label className={className ?? "inline-flex items-center justify-center"}>
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={ariaLabel}
        checked={isSelected}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.checked)}
        className="relative z-30 h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
      />
    </label>
  );
}

export function getPaginationPageNumbers(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", pageCount];
  }

  if (currentPage >= pageCount - 3) {
    return [1, "ellipsis", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", pageCount];
}
