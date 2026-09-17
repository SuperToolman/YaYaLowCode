"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteRecycleBinItem, emptyRecycleBinItems, restoreRecycleBinItem, saveRecycleBinSettings } from "./api";

export function useRecycleBinMutations() {
  const queryClient = useQueryClient();
  const refreshItems = () => queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
  return {
    restore: useMutation({ mutationFn: restoreRecycleBinItem, onSuccess: refreshItems }),
    remove: useMutation({ mutationFn: deleteRecycleBinItem, onSuccess: refreshItems }),
    empty: useMutation({ mutationFn: emptyRecycleBinItems, onSuccess: refreshItems }),
    saveSettings: useMutation({ mutationFn: saveRecycleBinSettings, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recycle-bin-settings"] }) }),
  };
}
