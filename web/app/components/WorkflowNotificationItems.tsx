"use client";

import { unwrapApiResult } from "@lib/api-request";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Dropdown } from "@heroui/react";
import { getWorkflowNotificationPreferences, listWorkflowNotifications, readWorkflowNotification } from "@/features/workflow/api";

type Notification = import("@lib/http").WorkflowNotificationResponse;

export function WorkflowNotificationItems({ onUnreadChange }: { onUnreadChange?: (count: number) => void }) {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    const result = unwrapApiResult(await listWorkflowNotifications());
    setItems(result.items);
    setUnread(result.unread);
    onUnreadChange?.(result.unread);
  }

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    void getWorkflowNotificationPreferences()
      .catch(() => null)
      .then((preferences) => {
        if (cancelled || preferences?.inAppEnabled === false) return;
        void load().catch(() => undefined);
        const interval = Math.max(15, Math.min(3_600, preferences?.pollIntervalSeconds ?? 60)) * 1_000;
        timer = window.setInterval(() => { void load().catch(() => undefined); }, interval);
      });
    return () => { cancelled = true; if (timer !== undefined) window.clearInterval(timer); };
  }, []);

  async function open(item: Notification) {
    if (!item.readAt) {
      const { data, error } = await readWorkflowNotification({ path: { notificationUuid: item.id }, responseStyle: "fields" });
      if (error || data?.code !== 0) return;
      setUnread((value) => Math.max(0, value - 1));
      onUnreadChange?.(Math.max(0, unread - 1));
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
      window.dispatchEvent(new Event("yaya-workflow-notifications-updated"));
    }
    if (item.appId) router.push(`/${item.appId}/${item.formUuid}?record=${encodeURIComponent(item.recordUuid)}`);
  }

  return <>
    <Dropdown.Item id="workflow-notifications" textValue="系统通知" className="rounded-lg text-[var(--color-text-primary)]" onAction={() => void load().catch(() => undefined)}>
      <span className="flex w-full items-center justify-between gap-3 py-1"><span>系统通知</span>{unread > 0 ? <Badge color="danger" size="sm" className="!static !translate-x-0 !translate-y-0">{unread > 99 ? "99+" : unread}</Badge> : null}</span>
    </Dropdown.Item>
    {items.slice(0, 8).map((item) => <Dropdown.Item key={item.id} id={`notification-${item.id}`} textValue={item.title} className={`rounded-lg ${item.readAt ? "" : "bg-[var(--color-primary-soft)]/40"}`} onAction={() => void open(item)}>
      <span className="block max-w-56 py-1"><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-0.5 block truncate text-[11px] text-[var(--color-text-secondary)]">{item.content}</span></span>
    </Dropdown.Item>)}
    {items.length === 0 ? <Dropdown.Item id="workflow-notifications-empty" isDisabled textValue="暂无通知" className="rounded-lg text-[var(--color-text-secondary)]">暂无通知</Dropdown.Item> : null}
    <Dropdown.Item id="all-notifications" textValue="查看全部消息" className="rounded-lg text-[var(--color-text-primary)]" onAction={() => router.push("/messages")}>查看全部消息</Dropdown.Item>
  </>;
}
