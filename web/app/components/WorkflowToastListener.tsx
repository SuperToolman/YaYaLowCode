"use client";

import { unwrapApiResult } from "@lib/api-request";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { getWorkflowNotificationPreferences, listWorkflowNotifications } from "@features/workflow/api";
import { notify } from "@lib/notify";
import { collectNewWorkflowNotices } from "@lib/workflow-toast-state";


export function WorkflowToastListener() {
  const { token, user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!token || !userId) return;
    let active = true;
    let timer: number | undefined;
    const startedAt = Date.now();
    const seen = new Set<string>();

    const poll = async () => {
      const result = unwrapApiResult(await listWorkflowNotifications());
      if (!active) return;
      for (const item of collectNewWorkflowNotices(seen, result.items, startedAt)) {
        notify.info(item.title, { description: item.content, dedupeKey: `workflow:${item.id}` });
      }
    };

    const run = async () => {
      let interval = 60_000;
      try {
        const preferences = await getWorkflowNotificationPreferences();
        if (!active) return;
        interval = Math.max(15, Math.min(3_600, preferences.pollIntervalSeconds ?? 60)) * 1_000;
        if (preferences.inAppEnabled !== false) await poll();
      } catch {
        // The next cycle retries preference and notification loading.
      } finally {
        if (active) timer = window.setTimeout(() => { void run(); }, interval);
      }
    };
    void run();

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [token, userId]);

  return null;
}
