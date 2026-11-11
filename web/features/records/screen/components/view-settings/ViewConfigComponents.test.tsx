import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Table, type Selection } from "@heroui/react";
import { describe, expect, it } from "vitest";
import type { ViewConfig } from "@/features/records/screen/model/use-form-views";
import { ReorderableViewFieldRow, ViewFieldsDragContext, type ViewFieldOption } from "@/features/records/screen/components/view-settings/ViewConfigComponents";

const childField: ViewFieldOption = {
  id: "field-name",
  label: "订单明细.商品名称",
  type: "singleLineText",
  typeLabel: "单行文本",
  parentSubformId: "subform-orders",
};

const subformField: ViewFieldOption = {
  id: "subform-orders",
  label: "订单明细",
  type: "subform",
  typeLabel: "子表单",
  isSubformGroup: true,
  linkedFieldIds: [childField.id],
  children: [childField],
};

const config: ViewConfig = {
  visibleFieldIds: [childField.id],
  sortableFieldIds: [],
  filters: [],
  sorts: [],
  columnOrder: [subformField.id, childField.id],
  columnWidths: {},
};

function ExpandableViewFieldTable() {
  const [expandedKeys, setExpandedKeys] = useState<Selection>(new Set());
  return (
    <ViewFieldsDragContext sensors={[]} onDragEnd={() => {}}>
      <Table>
        <Table.Content
          aria-label="显示列设置测试"
          treeColumn="viewFieldLabel"
          expandedKeys={expandedKeys}
          onExpandedChange={setExpandedKeys}
        >
          <Table.Header>
            <Table.Column id="viewFieldLabel" isRowHeader>字段</Table.Column>
            <Table.Column>字段类型</Table.Column>
            <Table.Column>显示列</Table.Column>
            <Table.Column>排序按钮</Table.Column>
            <Table.Column>宽</Table.Column>
            <Table.Column>操作</Table.Column>
          </Table.Header>
          <Table.Body>
            <ReorderableViewFieldRow
              field={subformField}
              config={config}
              onConfigChange={() => {}}
            />
          </Table.Body>
        </Table.Content>
      </Table>
    </ViewFieldsDragContext>
  );
}

describe("ReorderableViewFieldRow subform expansion", () => {
  it("allows reordering the subform group row", () => {
    render(<ExpandableViewFieldTable />);

    expect(
      screen.getByRole("button", { name: "拖拽调整订单明细列顺序" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("reveals dotted child field rows when the subform is expanded", () => {
    render(<ExpandableViewFieldTable />);

    expect(screen.queryByText(childField.label)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /展开或收起订单明细/ }),
    );
    expect(screen.getByText(childField.label)).toBeTruthy();
  });
});
