import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import { useRecordTableLayout } from "./use-record-table-layout";

vi.mock("@/features/form-runtime/queries", () => ({ useRuntimeMemberUsers: () => new Map() }));
afterEach(cleanup);

const schema: RuntimeFormSchema = {
  formUuid: "form", columns: 6, rows: 10, fields: [
    { id: "title", type: "singleLineText", label: "名称", row: 1, column: 1 },
    { id: "items", type: "subform", label: "明细", row: 2, column: 1 },
    { id: "amount", parentGroupId: "items", type: "number", label: "金额", row: 1, column: 1 },
  ],
};

it("expands subform columns after their summary and restores collapsed columns", () => {
  const { result } = renderHook(() => useRecordTableLayout({
    schema, fields: [schema.fields[0]], builtinFields: [], columnOrder: ["title", "items", "amount"],
  }));
  expect(result.current.tableColumns.map(column => column.field.id)).toEqual(["title", "items"]);
  act(() => result.current.setExpandedSubformKeys(new Set([JSON.stringify(["record", "items"])])));
  expect(result.current.tableColumns.map(column => column.field.id)).toEqual(["title", "items", "amount"]);
  expect(result.current.expandedRowKeys).toEqual(new Set(["record"]));
  act(() => result.current.setExpandedSubformKeys(new Set()));
  expect(result.current.tableColumns.map(column => column.field.id)).toEqual(["title", "items"]);
});

it("combines instance and submitter columns while keeping their configured order", () => {
  const builtinFields = [
    { id: "instanceId", label: "编号" }, { id: "instanceTitle", label: "标题" },
    { id: "submitter", label: "创建人" }, { id: "submitterOrganization", label: "组织" },
  ];
  const { result } = renderHook(() => useRecordTableLayout({
    schema: { ...schema, fields: [schema.fields[0]] }, fields: [schema.fields[0]],
    builtinFields, columnOrder: ["submitter", "submitterOrganization", "title", "instanceId", "instanceTitle"],
  }));
  expect(result.current.tableColumns.map(column => column.kind)).toEqual(["combinedSubmitter", "field", "combinedInstance"]);
});
