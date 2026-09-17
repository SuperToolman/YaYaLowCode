"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cleanupCommunication, updateCommunicationSettings } from "./api";

export function useCommunicationSettingsMutations<TSettings, TCleanup>() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["settings", "communication"] });
  return {
    save: useMutation({ mutationFn: updateCommunicationSettings<TSettings>, onSuccess: refresh }),
    cleanup: useMutation({ mutationFn: cleanupCommunication<TCleanup>, onSuccess: refresh }),
  };
}
