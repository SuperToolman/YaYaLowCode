"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import type { RuntimeFieldProps, RuntimeSchemaField } from "./runtime-form-renderer";

type RuntimeSubformTableProps = {
  childFields: RuntimeSchemaField[];
  props: RuntimeFieldProps;
  rows: Array<Record<string, unknown>>;
  showActions: boolean;
  renderCell: (field: RuntimeSchemaField, row: Record<string, unknown>, rowIndex: number) => ReactNode;
  renderActions: (rowIndex: number) => ReactNode;
};

export function RuntimeSubformTable({
  childFields,
  props,
  rows,
  showActions,
  renderCell,
  renderActions,
}: RuntimeSubformTableProps) {
  const pageSize = Math.max(1, props.subformPageSize ?? 20);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const [page, setPage] = useState(1);
  const activePage = Math.min(page, pageCount);
  const pageStart = (activePage - 1) * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);
  const columnCount = childFields.length + (props.subformShowIndex !== false ? 1 : 0) + (showActions ? 1 : 0);

  return (
    <>
      <div className={`subform-horizontal-scroll overflow-x-auto rounded-xl border border-[var(--color-border)] ${props.subformTheme === "border" ? "divide-y divide-[var(--color-border)]" : ""}`}>
        <table
          className="w-full border-collapse text-left text-sm"
          style={{
            tableLayout: props.subformLayoutMode === "auto" ? "auto" : "fixed",
            minWidth: Math.max(
              720,
              childFields.length * 180 +
                (props.subformShowIndex !== false ? 56 : 0) +
                (showActions ? props.subformActionColumnWidth ?? 70 : 0),
            ),
          }}
        >
          {props.subformShowHeader !== false ? (
            <thead className="bg-[var(--color-bg-subtle)]">
              <tr>
                {props.subformShowIndex !== false ? <th className="w-14 px-3 py-2 text-center font-medium">序号</th> : null}
                {childFields.map((child) => <th key={child.id} className="px-3 py-2 font-medium">{child.label}</th>)}
                {showActions ? <th className="sticky right-0 z-20 border-l border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-center font-medium shadow-[-6px_0_12px_-10px_rgba(15,23,42,0.7)]" style={{ width: props.subformActionColumnWidth ?? 70, minWidth: props.subformActionColumnWidth ?? 70 }}>操作</th> : null}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {pageRows.map((row, pageRowIndex) => {
              const rowIndex = pageStart + pageRowIndex;
              return (
                <tr key={rowIndex} className={props.subformTheme === "zebra" && rowIndex % 2 === 1 ? "bg-[var(--color-bg-subtle)]" : "border-t border-[var(--color-border)]"}>
                  {props.subformShowIndex !== false ? <td className="px-3 py-2 text-center text-[var(--color-text-secondary)]">{rowIndex + 1}</td> : null}
                  {childFields.map((child) => <td key={child.id} className="min-w-36 px-2 py-2 align-top">{renderCell(child, row, rowIndex)}</td>)}
                  {showActions ? <td className="sticky right-0 z-10 border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-2 align-middle shadow-[-6px_0_12px_-10px_rgba(15,23,42,0.7)]">{renderActions(rowIndex)}</td> : null}
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]" colSpan={columnCount}>暂无子表单数据，点击“{props.subformAddButtonText ?? "新增一项"}”开始填写。</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
        <span>共 {rows.length} 行</span>
        <div className="flex items-center gap-2">
          <span>第 {activePage}/{pageCount} 页 · 每页 {pageSize} 行</span>
          {pageCount > 1 ? <><Button size="sm" variant="ghost" isDisabled={activePage === 1} onPress={() => setPage(activePage - 1)}>上一页</Button><Button size="sm" variant="ghost" isDisabled={activePage === pageCount} onPress={() => setPage(activePage + 1)}>下一页</Button></> : null}
        </div>
      </div>
    </>
  );
}
