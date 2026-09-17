export type HistoryState<T> = { past: T[]; present: T; future: T[] };

export function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present: cloneSnapshot(present), future: [] };
}

export function commitHistory<T>(history: HistoryState<T> | null, present: T, limit = 100): HistoryState<T> {
  const snapshot = cloneSnapshot(present);
  if (!history) return createHistory(snapshot);
  return { past: [...history.past, history.present].slice(-limit), present: snapshot, future: [] };
}

export function undoHistory<T>(history: HistoryState<T>, limit = 100): HistoryState<T> | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, limit) };
}

export function redoHistory<T>(history: HistoryState<T>, limit = 100): HistoryState<T> | null {
  const next = history.future[0];
  if (!next) return null;
  return { past: [...history.past, history.present].slice(-limit), present: next, future: history.future.slice(1) };
}
