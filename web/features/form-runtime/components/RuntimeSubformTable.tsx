"use client";

import { useState, type ReactNode } from "react";
import { Button, Label, Table } from "@heroui/react";
import type {
  RuntimeFieldProps,
  RuntimeSchemaField,
} from "./RuntimeFormRenderer";

type RuntimeSubformTableProps = {
  childFields: RuntimeSchemaField[];
  props: RuntimeFieldProps;
  rows: Array<Record<string, unknown>>;
  showActions: boolean;
  renderCell: (
    field: RuntimeSchemaField,
    row: Record<string, unknown>,
    rowIndex: number,
  ) => ReactNode;
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
  const columns = [
    ...(props.subformShowIndex !== false
      ? [{ id: "index", label: "序号" }]
      : []),
    ...childFields.map((field) => ({
      id: `field:${field.id}`,
      label: field.label,
      field,
    })),
    ...(showActions ? [{ id: "actions", label: "操作" }] : []),
  ] as Array<{ id: string; label: string; field?: RuntimeSchemaField }>;
  if (columns.length === 0) columns.push({ id: "empty", label: "子表单" });

  return (
    <>
      <Table className="min-w-0">
        <Table.ScrollContainer className="min-w-0 max-w-full overflow-x-scroll [scrollbar-width:auto]! [scrollbar-color:auto]! [&::-webkit-scrollbar]:block! [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-text-secondary)] [&::-webkit-scrollbar-track]:bg-[var(--color-bg-subtle)]">
          <Table.Content
            aria-label="子表单数据"
            className="w-full text-left text-sm"
            style={{
              tableLayout:
                props.subformLayoutMode === "auto" ? "auto" : "fixed",
              minWidth: Math.max(
                720,
                childFields.length * 180 +
                  (props.subformShowIndex !== false ? 56 : 0) +
                  (showActions ? (props.subformActionColumnWidth ?? 70) : 0),
              ),
            }}
          >
            <Table.Header
              columns={columns}
              className={
                props.subformShowHeader === false ? "hidden" : undefined
              }
            >
              {(column) => (
                <Table.Column
                  id={column.id}
                  isRowHeader={column.id === columns[0].id}
                  textValue={column.label}
                  className={
                    column.id === "actions"
                      ? "sticky right-0 z-20 border-l border-[var(--color-border)] bg-[var(--surface-secondary)]!"
                      : undefined
                  }
                  style={
                    column.id === "index"
                      ? { width: 56 }
                      : column.id === "actions"
                        ? {
                            width: props.subformActionColumnWidth ?? 70,
                            minWidth: props.subformActionColumnWidth ?? 70,
                          }
                        : undefined
                  }
                >
                  {column.field ? (
                    <Label isRequired={column.field.props?.isRequired}>
                      {column.label}
                    </Label>
                  ) : (
                    column.label
                  )}
                </Table.Column>
              )}
            </Table.Header>
            <Table.Body
              items={pageRows.map((row, index) => ({
                id: pageStart + index,
                row,
              }))}
              renderEmptyState={() => (
                <p className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  暂无子表单数据，点击“
                  {props.subformAddButtonText ?? "新增一项"}”开始填写。
                </p>
              )}
            >
              {(item) => (
                <Table.Row id={item.id} columns={columns}>
                  {(column) => (
                    <Table.Cell
                      className={
                        column.id === "actions"
                          ? "sticky right-0 z-10 border-l border-[var(--color-border)] bg-[var(--surface)]!"
                          : "p-2 align-center"
                      }
                    >
                      {column.field
                        ? renderCell(column.field, item.row, item.id)
                        : column.id === "index"
                          ? item.id + 1
                          : column.id === "actions"
                            ? renderActions(item.id)
                            : null}
                    </Table.Cell>
                  )}
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
        <span>共 {rows.length} 行</span>
        <div className="flex items-center gap-2">
          <span>
            第 {activePage}/{pageCount} 页 · 每页 {pageSize} 行
          </span>
          {pageCount > 1 ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={activePage === 1}
                onPress={() => setPage(activePage - 1)}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={activePage === pageCount}
                onPress={() => setPage(activePage + 1)}
              >
                下一页
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
