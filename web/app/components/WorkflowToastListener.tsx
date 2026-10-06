"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { getWorkflowNotificationPreferences, listWorkflowNotifications } from "@features/workflow/api";
import { notify } from "@lib/notify";
import { collectNewWorkflowNotices, type WorkflowNotice } from "@lib/workflow-toast-state";

type NoticeEnvelope = {
  code: number;
  data: { items?: WorkflowNotice[] } | null;
};

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
      const { data, error } = await listWorkflowNotifications({ responseStyle: "fields" });
      if (!active || error) return;
      const result = data as NoticeEnvelope | undefined;
      if (result?.code !== 0) return;
      for (const item of collectNewWorkflowNotices(seen, result.data?.items ?? [], startedAt)) {
        notify.info(item.title, { description: item.content, dedupeKey: `workflow:${item.id}` });
      }
    };

    const run = async () => {
      let interval = 60_000;
      try {
        const preferences = await getWorkflowNotificationPreferences<{ inAppEnabled?: boolean; pollIntervalSeconds?: number }>();
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
