"use client";

import { useQuery } from "@tanstack/react-query";
import { getCommunicationSettings, getCommunicationStats } from "./api";

export function useCommunicationSettingsQuery<T>() {
  return useQuery({ queryKey: ["settings", "communication"], queryFn: getCommunicationSettings<T>, staleTime: 60_000 });
}

export function useCommunicationStatsQuery<T>(enabled: boolean) {
  return useQuery({ queryKey: ["settings", "communication", "storage"], queryFn: getCommunicationStats<T>, enabled, staleTime: 30_000 });
}
