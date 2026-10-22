"use client";

import { useQuery } from "@tanstack/react-query";
import { getCommunicationSettings, getCommunicationStats } from "./api";

export function useCommunicationSettingsQuery() {
  return useQuery({ queryKey: ["settings", "communication"], queryFn: getCommunicationSettings, staleTime: 60_000 });
}

export function useCommunicationStatsQuery(enabled: boolean) {
  return useQuery({ queryKey: ["settings", "communication", "storage"], queryFn: getCommunicationStats, enabled, staleTime: 30_000 });
}
