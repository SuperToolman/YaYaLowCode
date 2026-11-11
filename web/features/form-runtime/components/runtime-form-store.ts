import type { RuntimeDebugEvent } from "../../form-model/runtime-types";

export type RuntimeRendererState = {
  values: Record<string, unknown>;
  dataSources: Record<string, unknown>;
  formulaErrors: Record<string, string>;
  debugEvent?: RuntimeDebugEvent;
};
export type FieldSnapshot = { value: unknown; error?: string; formulaError?: string };
export const EMPTY_FIELD_SNAPSHOT: FieldSnapshot = Object.freeze({ value: undefined });
export const EMPTY_VALUES: Record<string, unknown> = Object.freeze({});
export const EMPTY_ERRORS: Record<string, string> = Object.freeze({});

/** One store per mounted form. Field snapshots remain stable until that field changes. */
export function createRuntimeFormStore(initial: RuntimeRendererState) {
  let state = initial;
  let errors: Record<string, string> = EMPTY_ERRORS;
  const snapshots = new Map<string, FieldSnapshot>();
  const fieldListeners = new Map<string, Set<() => void>>();
  const listeners = new Set<() => void>();
  let batchDepth = 0;
  let dirty = false;
  function flush() {
    if (batchDepth || !dirty) return;
    dirty = false;
    const changed: string[] = [];
    for (const [id, previous] of snapshots) {
      const value = state.values[id], error = errors[id], formulaError = state.formulaErrors[id];
      if (Object.is(previous.value, value) && previous.error === error && previous.formulaError === formulaError) continue;
      snapshots.set(id, { value, error, formulaError });
      changed.push(id);
    }
    // Publish every snapshot before notifying any observer.
    for (const id of changed) fieldListeners.get(id)?.forEach((listener) => listener());
    listeners.forEach((listener) => listener());
  }
  function getFieldSnapshot(id: string): FieldSnapshot {
    let snapshot = snapshots.get(id);
    if (!snapshot) {
      snapshot = { value: state.values[id], error: errors[id], formulaError: state.formulaErrors[id] };
      snapshots.set(id, snapshot);
    }
    return snapshot;
  }
  return {
    batch<T>(action: () => T): T {
      batchDepth++;
      try { return action(); } finally { batchDepth--; flush(); }
    },
    getState: () => state,
    getValues: () => state.values,
    getFieldSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeField: (id: string, listener: () => void) => {
      const entries = fieldListeners.get(id) ?? new Set();
      entries.add(listener);
      fieldListeners.set(id, entries);
      return () => { entries.delete(listener); if (!entries.size) fieldListeners.delete(id); };
    },
    publish(next: RuntimeRendererState, nextErrors: Record<string, string> = errors) {
      state = next;
      errors = nextErrors;
      dirty = true;
      flush();
    },
  };
}
export type RuntimeFormStore = ReturnType<typeof createRuntimeFormStore>;
