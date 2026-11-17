import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { RecordsTable } from "./RecordsTable";

vi.mock("@/features/form-runtime/queries", () => ({ useRuntimeMemberUsers: () => new Map() }));
vi.mock("@/shared/providers/ThemeProvider", () => ({ useTheme: () => ({ appearance: { surfaceVariant: "default" } }) }));
vi.mock("@/features/records/queries", () => ({ useAssociationFormsQuery: () => new Map() }));
vi.mock("@/features/records/model/use-copy-record", () => ({ useCopyRecord: () => ({ copyRecord: vi.fn(), copyingRecordId: null }) }));
vi.mock("@/features/custom-buttons/api", () => ({ getViewButtons: async () => [] }));
vi.mock("@/features/form-runtime/components", () => ({ RuntimeFormSurface: () => null }));
vi.mock("@/features/records/screen/components/RuntimeFormPanel", () => ({ RuntimeFormPanel: () => null }));
vi.mock("@/features/records/screen/components/record-detail/RecordDetailDrawer", () => ({ RecordDetailDrawer: () => null }));
vi.mock("@/features/custom-buttons/components/CustomButtonFillDrawer", () => ({ CustomButtonFillDrawer: () => null }));
vi.mock("@/features/records/screen/actions/CustomButtonPageDrawer", () => ({ CustomButtonPageDrawer: () => null }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function props(): ComponentProps<typeof RecordsTable> {
  const fields = [{ id: "name", label: "名称", type: "singleLineText" as const, row: 1, column: 1 }];
  return {
    builtinFields: [], columnOrder: ["name"], columnWidths: {}, frozenFieldIds: ["name"], sorts: [], sortableFieldIds: ["name"],
    deletingRecordId: null, fields, formType: "normal", formName: "测试表单",
    schema: { formUuid: "form", columns: 6, rows: 10, fields },
    records: ["甲", "乙"].map((name, index) => ({ id: `r${index}`, formUuid: "form", schemaVersion: 1, data: { name }, createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z", createdBy: "test", updatedBy: "test" })),
    selectedRecordIds: new Set(), submitting: false,
    onDeleteRecord: vi.fn(), onUpdateRecord: vi.fn(), onWorkflowAction: vi.fn(), onCompleteExecutionTask: vi.fn(), onRefreshRecords: vi.fn(),
    canEditRecord: true, canCreateRecord: true, canDeleteRecord: true, urlParams: { formUuid: "form" },
    onRecordSelectionChange: vi.fn(), onPageSelectionChange: vi.fn(), onViewConfigChange: vi.fn(),
  };
}

it("uses HeroUI columns for accessible sorting, frozen edges and column resizing", async () => {
  const input = props();
  render(<RecordsTable {...input} />);
  const name = screen.getByRole("columnheader", { name: /名称/ });
  expect(name.getAttribute("data-pin")).toBe("left");
  expect(screen.getByRole("columnheader", { name: "操作" }).getAttribute("data-pin")).toBe("right");
  expect(screen.getByRole("slider", { name: /调整名称列宽/ })).toBeTruthy();
  fireEvent.click(name);
  await waitFor(() => expect(input.onViewConfigChange).toHaveBeenCalledWith({ sorts: [{ id: "header-sort-name", fieldId: "name", direction: "asc" }] }));
});

it("keeps explicit row/page selection and shows an indeterminate header", () => {
  const input = props();
  input.selectedRecordIds = new Set(["r0"]);
  render(<RecordsTable {...input} />);
  expect((screen.getByRole("checkbox", { name: "全选当前页" }) as HTMLInputElement).indeterminate).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "选择第 2 行" }));
  expect(input.onRecordSelectionChange).toHaveBeenCalledWith("r1", true);
  fireEvent.click(screen.getByRole("checkbox", { name: "全选当前页" }));
  expect(input.onPageSelectionChange).toHaveBeenCalledWith(["r0", "r1"], new Set(["r0", "r1"]));
});

it("expands and collapses actual subform rows with HeroUI tree collections", async () => {
  const input = props();
  const subform = { id: "items", label: "明细", type: "subform" as const, row: 2, column: 1 };
  const child = { id: "amount", parentGroupId: "items", label: "金额", type: "number" as const, row: 1, column: 1 };
  input.schema.fields.push(subform, child);
  input.columnOrder.push("items", "amount");
  input.records = [{ ...input.records[0], data: { name: "主记录", items: [{ amount: 42 }] } }];
  render(<RecordsTable {...input} />);
  expect(screen.queryByText("42")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开明细" }));
  await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
  expect(screen.getByText("明细.金额")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "收起明细" }));
  await waitFor(() => expect(screen.queryByText("42")).toBeNull());
});

it("renders HeroUI's empty state without a fake data row", () => {
  render(<RecordsTable {...props()} records={[]} />);
  expect(screen.getByText("暂无数据")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /选择第/ })).toBeNull();
});

it("passes exact configured widths to HeroUI and restores capped dynamic sizing when cleared", () => {
  const input = props();
  input.columnWidths = { name: 420 };
  input.records[0].data.name = "长内容".repeat(100);
  const { rerender } = render(<RecordsTable {...input} />);
  const header = () => screen.getByRole("columnheader", { name: /名称/ }) as HTMLElement;
  expect(header().style.width).toBe("420px");
  rerender(<RecordsTable {...input} columnWidths={{}} />);
  expect(header().style.width).toBe("320px");
  expect(header().style.left).toBe("44px");
});
