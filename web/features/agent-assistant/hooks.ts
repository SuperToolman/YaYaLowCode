"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAgentMessages, fetchAgentSessions } from "./api";

export function useAgentSessionsQuery(enabled = true) {
  return useQuery({
    queryKey: ["agent-sessions"],
    queryFn: fetchAgentSessions,
    enabled,
    staleTime: 60_000,
  });
}

export function useAgentMessagesQuery(sessionId: string | null) {
  return useQuery({
    queryKey: ["agent-messages", sessionId],
    queryFn: () => fetchAgentMessages(sessionId!),
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  });
}
