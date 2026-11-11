"use client";

import { useCallback, useRef, useState } from "react";

export type ImportProgress = { total: number; completed: number; succeeded: number; failed: number; cancelled: boolean };
export type ImportResult = { index: number; error?: string };

export function useRecordImportExport<TInput>(run: (input: TInput, signal: AbortSignal) => Promise<ImportResult>) {
  const controllerRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({ total: 0, completed: 0, succeeded: 0, failed: 0, cancelled: false });
  const [running, setRunning] = useState(false);
  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const importAll = useCallback(async (inputs: TInput[], concurrency = 3) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setProgress({ total: inputs.length, completed: 0, succeeded: 0, failed: 0, cancelled: false });
    let cursor = 0;
    let succeeded = 0;
    let failed = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = cursor++;
        if (index >= inputs.length) return;
        try { const result = await run(inputs[index], controller.signal); succeeded += result.error ? 0 : 1; failed += result.error ? 1 : 0; setProgress((current) => ({ ...current, completed: current.completed + 1, succeeded, failed })); }
        catch { if (!controller.signal.aborted) { failed += 1; setProgress((current) => ({ ...current, completed: current.completed + 1, failed })); } }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, inputs.length)) }, worker));
    const finalProgress = { total: inputs.length, completed: succeeded + failed, succeeded, failed, cancelled: controller.signal.aborted };
    setProgress((current) => ({ ...current, cancelled: controller.signal.aborted }));
    if (controllerRef.current === controller) controllerRef.current = null;
    setRunning(false);
    return finalProgress;
  }, [run]);
  return { progress, running, importAll, cancel };
}
