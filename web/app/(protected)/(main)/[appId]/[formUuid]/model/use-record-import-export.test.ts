import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRecordImportExport } from "./use-record-import-export";

describe("record import controller", () => {
  it("tracks successful and failed rows", async () => {
    const run = vi.fn(async (input: number) => input === 2 ? { index: input, error: "invalid" } : { index: input });
    const { result } = renderHook(() => useRecordImportExport(run));
    await act(async () => { await result.current.importAll([1, 2, 3], 2); });
    expect(result.current.progress).toMatchObject({ total: 3, completed: 3, succeeded: 2, failed: 1, cancelled: false });
  });
});
