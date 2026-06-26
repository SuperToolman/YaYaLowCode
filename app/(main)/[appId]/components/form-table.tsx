"use client";

import { Avatar, Button, Chip, Table, ButtonGroup, } from "@heroui/react";
import type { FormColumn, FormRow } from "../../../lib/apps";
import {
  Ellipsis,
  Picture,
  Video,
} from "@gravity-ui/icons";

export function FormTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: FormColumn[];
  rows: FormRow[];
}) {
  const tableColumns = columns.map((column) => ({
    ...column,
    id: column.key,
  }));
  const tableRows: Array<FormRow & { id: string }> = rows.map((row) => ({
    ...row,
    id: getRowKey(row),
  }));
  const firstColumnId = tableColumns[0]?.id;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
      <Table>
        <Table.ScrollContainer className="overflow-x-auto">
          <Table.Content aria-label={`${title} 数据表格`}>
            <Table.Header>
              <Table.Collection items={tableColumns}>
                {(column) => (
                  <Table.Column
                    key={column.id}
                    isRowHeader={column.id === firstColumnId}
                    style={column.width ? { width: column.width } : undefined}
                  >
                    {column.label}
                  </Table.Column>
                )}
              </Table.Collection>
              <Table.Column>
                操作
              </Table.Column>
            </Table.Header>

            <Table.Body>
              <Table.Collection items={tableRows}>
                {(row) => (
                  <Table.Row key={row.id}>
                    <Table.Collection items={tableColumns}>
                      {(column) => (
                        <Table.Cell key={column.id}>
                          <CellValue
                            columnKey={column.key}
                            value={row[column.key] ?? "-"}
                          />
                        </Table.Cell>
                      )}
                    </Table.Collection>
                    <Table.Cell>
                      <ButtonGroup variant="tertiary">
                        <Button>
                          <Picture />
                          Photos
                        </Button>
                        <Button>
                          <ButtonGroup.Separator />
                          <Video />
                          Videos
                        </Button>
                        <Button isIconOnly aria-label="More options">
                          <ButtonGroup.Separator />
                          <Ellipsis />
                        </Button>
                      </ButtonGroup>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function CellValue({
  columnKey,
  value,
}: {
  columnKey: string;
  value: string;
}) {
  if (columnKey === "status") {
    const color =
      value === "完成" || value === "充足"
        ? "success"
        : value === "进行中" || value === "预警"
          ? "warning"
          : "default";

    return (
      <Chip color={color} size="sm">
        {value}
      </Chip>
    );
  }

  if (columnKey === "owner" || columnKey === "keeper") {
    return (
      <div className="flex items-center gap-3">
        <Avatar

          size="sm"

        />
        <span>{value}</span>
      </div>
    );
  }

  return <span>{value}</span>;
}

function getRowKey(row: FormRow) {
  return row.code ?? row.sku ?? row.name ?? Object.values(row).join("-");
}
