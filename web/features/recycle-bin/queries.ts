"use client";

import { useQuery } from "@tanstack/react-query";
import { listRecycleBinEntries, loadRecycleBinSettings } from "./api";

export function useRecycleBinQuery(formUuid?: string) {
  return useQuery({
    queryKey: ["recycle-bin", formUuid ?? null],
    queryFn: () => listRecycleBinEntries(formUuid),
    staleTime: 30_000,
  });
}

export function useRecycleBinSettingsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["recycle-bin-settings"],
    queryFn: loadRecycleBinSettings,
    enabled,
    staleTime: 60_000,
  });
}
