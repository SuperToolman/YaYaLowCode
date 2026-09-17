"use client";

import { useCallback, useState } from "react";
import { createRecordFormDraft, readRecordFormDrafts, saveRecordFormDrafts, type RecordFormDraft } from "./drafts";

export function useRecordEditor(formUuid: string, initialValues: Record<string, unknown> = {}, options?: { create?: (values: Record<string, unknown>) => Promise<unknown>; update?: (recordUuid: string, values: Record<string, unknown>) => Promise<unknown> }) {
  const [values, setValues] = useState(initialValues);
  const [drafts, setDrafts] = useState<RecordFormDraft[]>(() => typeof window === "undefined" ? [] : readRecordFormDrafts(formUuid));
  const reset = useCallback((next: Record<string, unknown> = {}) => setValues(next), []);
  const saveDraft = useCallback(() => { const next = [createRecordFormDraft(values), ...drafts].slice(0, 20); setDrafts(next); saveRecordFormDrafts(formUuid, next); return next[0]; }, [drafts, formUuid, values]);
  const removeDraft = useCallback((id: string) => { const next = drafts.filter((draft) => draft.id !== id); setDrafts(next); saveRecordFormDrafts(formUuid, next); }, [drafts, formUuid]);
  const submitCreate = useCallback(async (nextValues: Record<string, unknown>) => { if (!options?.create) throw new Error("创建 mutation 未配置"); return options.create(nextValues); }, [options]);
  const submitUpdate = useCallback(async (recordUuid: string, nextValues: Record<string, unknown>) => { if (!options?.update) throw new Error("更新 mutation 未配置"); return options.update(recordUuid, nextValues); }, [options]);
  return { values, setValues, drafts, reset, saveDraft, removeDraft, submitCreate, submitUpdate };
}
