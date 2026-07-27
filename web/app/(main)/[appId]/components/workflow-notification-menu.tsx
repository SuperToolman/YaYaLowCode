"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "../../../components/app-icons";

type Notification = { id: string; title: string; content: string; formUuid: string; recordUuid: string; readAt: string | null; createdAt: string };
type Envelope = { code: number; message: string; data: { unread?: number; items?: Notification[] } | null };

export function WorkflowNotificationMenu({ appId }: { appId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    const response = await fetch("/api/workflow/notifications", { cache: "no-store" });
    const result = await response.json() as Envelope;
    if (!response.ok || result.code !== 0) throw new Error(result.message);
    setItems(result.data?.items ?? []);
    setUnread(result.data?.unread ?? 0);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch(() => undefined); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function openNotification(item: Notification) {
    if (!item.readAt) {
      await fetch(`/api/workflow/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" }).catch(() => undefined);
      setUnread((value) => Math.max(0, value - 1));
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
    }
    setOpen(false);
    router.push(`/${appId}/${item.formUuid}?record=${encodeURIComponent(item.recordUuid)}`);
  }

  return <div className="relative ml-1">
    <button type="button" aria-label="流程通知" onClick={() => { setOpen((value) => !value); if (!open) void load().catch(() => undefined); }} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]">
      <BellIcon />
      {unread > 0 ? <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-[var(--color-danger)] px-1 text-center text-[10px] leading-4 text-white">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
    {open ? <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-menu)] shadow-[var(--shadow-floating)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)]">流程通知</div>
      <div className="max-h-96 overflow-y-auto">{items.length === 0 ? <div className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">暂无通知</div> : items.slice(0, 20).map((item) => <button key={item.id} type="button" onClick={() => void openNotification(item)} className={`block w-full border-b border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-bg-panel-soft)] ${item.readAt ? "" : "bg-[var(--color-primary-soft)]/40"}`}><div className="text-sm font-medium text-[var(--color-text-primary)]">{item.title}</div><div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{item.content}</div><div className="mt-1 text-[11px] text-[var(--color-text-disabled)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</div></button>)}</div>
    </div> : null}
  </div>;
}
