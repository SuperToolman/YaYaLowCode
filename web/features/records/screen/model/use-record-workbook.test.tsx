import { act, cleanup, renderHook } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import { notify } from "@/shared/lib/notify";
import { parseExcelFile, type ParsedImportWorkbook } from "../xlsx-worker-client";
import { useRecordWorkbook } from "./use-record-workbook";

vi.mock("../xlsx-worker-client", () => ({ parseExcelFile: vi.fn(), buildExcelWorkbook: vi.fn(), downloadExcelBuffer: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { error: vi.fn(), warning: vi.fn(), success: vi.fn() }, notifyRequestError: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const schema: RuntimeFormSchema = {
  formUuid: "form", columns: 6, rows: 10,
  fields: [{ id: "name", label: "名称", type: "singleLineText", row: 1, column: 1, props: { isRequired: true } }],
};

function setup() {
  const createRecord = vi.fn(async () => undefined);
  const loadRecords = vi.fn(async () => undefined);
  return { ...renderHook(() => useRecordWorkbook({
    schema, formMetadataName: "客户", formUuid: "form", selectedRecordIds: new Set(),
    displayedRecords: [], visibleFields: schema.fields, createRecord, loadRecords,
  })), createRecord, loadRecords };
}

it("rejects an import with missing required mappings before writing records", async () => {
  const { result, createRecord } = setup();
  await act(() => result.current.importExcelRows());
  expect(createRecord).not.toHaveBeenCalled();
  expect(notify.error).toHaveBeenCalledWith("请匹配所有必填字段", { description: "名称" });
});

it("retains successful rows and reports partial failures after refreshing records", async () => {
  const { result, createRecord, loadRecords } = setup();
  createRecord.mockRejectedValueOnce(new Error("记录校验失败"));
  act(() => result.current.setImportState(current => ({
    ...current, headers: ["名称"], rows: [["甲"], ["乙"]], mappings: { 0: "name" },
  })));
  await act(() => result.current.importExcelRows());
  expect(createRecord).toHaveBeenCalledTimes(2);
  expect(loadRecords).toHaveBeenCalledTimes(1);
  expect(result.current.importState).toMatchObject({ completed: true, importing: false, successCount: 1, failureCount: 1 });
  expect(notify.warning).toHaveBeenCalledWith("导入完成", { description: "成功 1 条，失败 1 条。" });
});

it("ignores a worksheet response received after the import panel was reset", async () => {
  let finish!: (value: ParsedImportWorkbook) => void;
  vi.mocked(parseExcelFile).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = setup();
  const file = { name: "客户.xlsx", arrayBuffer: async () => new ArrayBuffer(1) };
  let reading!: Promise<void>;
  await act(async () => {
    reading = result.current.handleImportFileChange({ currentTarget: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>);
    await Promise.resolve();
  });
  act(() => result.current.openImportModal());
  await act(async () => {
    finish({ headers: ["名称"], rows: [["旧数据"]], rowGroups: [0], mappings: { 0: "name" }, sheetName: "数据", sheetNames: ["数据"] });
    await reading;
  });
  expect(result.current.importState.fileName).toBe("");
  expect(result.current.importState.rows).toEqual([]);
});
