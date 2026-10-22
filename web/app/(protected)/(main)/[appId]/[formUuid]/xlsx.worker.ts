import * as XLSX from "xlsx";

import { parseImportWorksheet, type ExcelImportColumn as ExcelColumn } from "@features/records/model/excel-import";
type WorkerRequest =
  | { type: "parse"; requestId: string; buffer: ArrayBuffer; columns: ExcelColumn[]; sheetName?: string }
  | { type: "build"; requestId: string; matrix: unknown[][]; sheetName: string; merges?: XLSX.Range[]; columnWidth: number };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "parse") {
      const workbook = XLSX.read(request.buffer, { type: "array" });
      const sheetName = request.sheetName ?? workbook.SheetNames[0];
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
      if (!worksheet) throw new Error("Excel 文件中没有可读取的工作表");

      const result = worksheet["!ref"] ? parseImportWorksheet(worksheet, request.columns) : { headers: [], rows: [], mappings: {}, rowGroups: [] };
      self.postMessage({ type: "parsed", requestId: request.requestId, sheetName, sheetNames: workbook.SheetNames, ...result });
      return;
    }

    const worksheet = XLSX.utils.aoa_to_sheet(request.matrix);
    worksheet["!merges"] = request.merges ?? [];
    worksheet["!cols"] = (request.matrix[0] ?? []).map(() => ({ wch: request.columnWidth }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, request.sheetName);
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
    const postTransferable = self.postMessage as unknown as (message: unknown, transfer: Transferable[]) => void;
    postTransferable({ type: "built", requestId: request.requestId, buffer }, [buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Excel 处理失败",
    });
  }
};

export {};
