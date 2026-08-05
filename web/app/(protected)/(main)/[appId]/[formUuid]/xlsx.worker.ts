import * as XLSX from "xlsx";

type ExcelColumn = { id: string; label: string; header: string };
type WorkerRequest =
  | { type: "parse"; requestId: string; buffer: ArrayBuffer; columns: ExcelColumn[] }
  | { type: "build"; requestId: string; matrix: unknown[][]; sheetName: string; columnWidth: number };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "parse") {
      const workbook = XLSX.read(request.buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
      if (!worksheet) throw new Error("Excel 文件中没有可读取的工作表");

      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      }) as unknown[][];
      const headers = (matrix[0] ?? []).map((cell) => String(cell).trim());
      if (headers.length === 0) throw new Error("Excel 第一行必须包含字段标题");
      const rows = matrix.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
      const mappings = Object.fromEntries(headers.map((header, index) => {
        const matched = request.columns.find((column) =>
          column.header === header || column.label === header || column.id === header,
        );
        return [index, matched?.id ?? ""];
      }));
      self.postMessage({ type: "parsed", requestId: request.requestId, headers, rows, mappings });
      return;
    }

    const worksheet = XLSX.utils.aoa_to_sheet(request.matrix);
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
