"use client";

import { useCallback, useEffect, useState } from "react";

export type RecordFormDraft = { id: string; savedAt: string; values: Record<string, unknown> };

function storageKey(formUuid: string) {
  return `yaya-low-code:form-drafts:${formUuid}`;
}

export function readRecordFormDrafts(formUuid: string): RecordFormDraft[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(formUuid)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((draft): draft is RecordFormDraft => Boolean(
      draft && typeof draft === "object" && "id" in draft && "savedAt" in draft && "values" in draft,
    ));
  } catch {
    return [];
  }
}

export function saveRecordFormDrafts(formUuid: string, drafts: RecordFormDraft[]) {
  window.localStorage.setItem(storageKey(formUuid), JSON.stringify(drafts));
}

export function createRecordFormDraft(values: Record<string, unknown>): RecordFormDraft {
  return { id: `draft-${Date.now()}`, savedAt: new Date().toISOString(), values };
}

export function useRecordDrafts(formUuid: string) {
  const [drafts, setDrafts] = useState<RecordFormDraft[]>([]);
  // Local storage is the source of truth for drafts; defer the browser read until mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDrafts(readRecordFormDrafts(formUuid)); }, [formUuid]);
  const saveDraft = useCallback((values: Record<string, unknown>) => { const next = [createRecordFormDraft(values), ...readRecordFormDrafts(formUuid)].slice(0, 50); saveRecordFormDrafts(formUuid, next); setDrafts(next); return next[0]; }, [formUuid]);
  const deleteDraft = useCallback((draftId: string) => { const next = readRecordFormDrafts(formUuid).filter((draft) => draft.id !== draftId); saveRecordFormDrafts(formUuid, next); setDrafts(next); }, [formUuid]);
  return { drafts, saveDraft, deleteDraft, refreshDrafts: () => setDrafts(readRecordFormDrafts(formUuid)) };
}
