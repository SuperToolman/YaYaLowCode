"use client";

import type { ReactNode } from "react";

export function SubformHeader({ label, description, children }: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  const text = description?.trim();
  return (
    <div className="flex min-h-8 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
        {text && text !== "可拖入普通字段作为表格列。" ? (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{text}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SubformPagination({ total, page, pageCount, pageSize, children }: {
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
      <span>共 {total} 行</span>
      <div className="flex items-center gap-2">
        <span>第 {page}/{pageCount} 页 · 每页 {pageSize} 行</span>
        {children}
      </div>
    </div>
  );
}
