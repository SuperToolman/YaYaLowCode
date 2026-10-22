"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cleanupCommunication, updateCommunicationSettings } from "./api";

export function useCommunicationSettingsMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["settings", "communication"] });
  return {
    save: useMutation({ mutationFn: updateCommunicationSettings, onSuccess: refresh }),
    cleanup: useMutation({ mutationFn: cleanupCommunication, onSuccess: refresh }),
  };
}
