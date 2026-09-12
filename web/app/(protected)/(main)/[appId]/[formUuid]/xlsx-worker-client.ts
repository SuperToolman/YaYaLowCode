import { createRandomUuid } from "@/app/lib/random-uuid";

type ExcelColumn = { id: string; label: string; header: string };
type ParsedExcel = { headers: string[]; rows: unknown[][]; mappings: Record<number, string> };

function runWorker<TResult>(
  message: Record<string, unknown>,
  transfer: Transferable[] = [],
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./xlsx.worker.ts", import.meta.url));
    const requestId = createRandomUuid();
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      if (event.data.requestId !== requestId) return;
      worker.terminate();
      if (event.data.type === "error") reject(new Error(String(event.data.message)));
      else resolve(event.data as TResult);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Excel Worker 执行失败"));
    };
    worker.postMessage({ ...message, requestId }, transfer);
  });
}

export async function parseExcelFile(buffer: ArrayBuffer, columns: ExcelColumn[]): Promise<ParsedExcel> {
  const result = await runWorker<{ headers: string[]; rows: unknown[][]; mappings: Record<number, string> }>(
    { type: "parse", buffer, columns },
    [buffer],
  );
  return { headers: result.headers, rows: result.rows, mappings: result.mappings };
}

export async function buildExcelWorkbook(matrix: unknown[][], sheetName = "数据"): Promise<ArrayBuffer> {
  const result = await runWorker<{ buffer: ArrayBuffer }>({
    type: "build",
    matrix,
    sheetName,
    columnWidth: 22,
  });
  return result.buffer;
}

export function downloadExcelBuffer(buffer: ArrayBuffer, fileName: string) {
  const url = URL.createObjectURL(new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
