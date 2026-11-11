"use client";

import { useCallback, useEffect, useState, type SetStateAction } from "react";

type ExpandedGroups = Record<string, boolean>;

function readGroups(storageKey: string): ExpandedGroups {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, expanded]) => typeof expanded === "boolean"),
    );
  } catch {
    return {};
  }
}

export function useExpandedGroups(routeAppId: string) {
  const storageKey = `yaya-app-navigation-expanded-groups:${routeAppId}`;
  const [state, setState] = useState<{ key: string; groups: ExpandedGroups } | null>(null);

  useEffect(() => {
    // Read after hydration so the server and initial client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ key: storageKey, groups: readGroups(storageKey) });
  }, [storageKey]);

  useEffect(() => {
    // Never overwrite saved preferences with the initial empty state or another app's state.
    if (state?.key !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state.groups));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, [state, storageKey]);

  const setExpandedGroups = useCallback((action: SetStateAction<ExpandedGroups>) => {
    setState((current) => {
      const groups = current?.key === storageKey ? current.groups : {};
      return {
        key: storageKey,
        groups: typeof action === "function" ? action(groups) : action,
      };
    });
  }, [storageKey]);

  return [state?.key === storageKey ? state.groups : {}, setExpandedGroups] as const;
}
