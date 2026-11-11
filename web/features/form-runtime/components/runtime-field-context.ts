"use client";

import { createContext, useContext, useCallback, useSyncExternalStore } from "react";
import type { RuntimePageAsset } from "../../form-model/runtime-types";
import { EMPTY_VALUES, EMPTY_FIELD_SNAPSHOT, type RuntimeFormStore } from "./runtime-form-store";

export const RuntimeStoreContext = createContext<RuntimeFormStore | null>(null);

export const EMPTY_ASSETS: RuntimePageAsset[] = [];

export const EMPTY_IDS: string[] = [];

export const NO_FIELD_ACTION = () => undefined;

export function useRuntimeFieldSnapshot(id: string) {
  const store = useContext(RuntimeStoreContext);
  const subscribe = useCallback((listener: () => void) => store?.subscribeField(id, listener) ?? (() => undefined), [store, id]);
  const getSnapshot = useCallback(() => store?.getFieldSnapshot(id) ?? EMPTY_FIELD_SNAPSHOT, [store, id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useRuntimeValues(enabled: boolean) {
  const store = useContext(RuntimeStoreContext);
  const subscribe = useCallback((listener: () => void) => enabled && store ? store.subscribe(listener) : () => undefined, [store, enabled]);
  const getSnapshot = useCallback(() => enabled && store ? store.getValues() : EMPTY_VALUES, [store, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const CurrentUserIdContext = createContext<string | undefined>(undefined);
