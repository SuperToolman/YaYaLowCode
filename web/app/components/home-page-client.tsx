"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, Clock, File, FilePlus } from "@gravity-ui/icons";
import type { AppItem } from "../lib/apps";

const workItems = [
  { slug: "todo", label: "待我处理", description: "等待你处理的任务", icon: <CircleCheck />, tone: "blue" },
  { slug: "processed", label: "我处理的", description: "已完成或已处理事项", icon: <Clock />, tone: "green" },
  { slug: "created", label: "我创建的", description: "由你发起的事项", icon: <FilePlus />, tone: "amber" },
  { slug: "copied", label: "抄送我的", description: "需要知悉的通知与记录", icon: <File />, tone: "violet" },
] as const;

export function HomeQuickAccess({ apps }: { apps: AppItem[] }) {
  const taskApp = apps.find((app) => app.status === "enabled") ?? apps[0];
  return (
    <section aria-labelledby="work-items-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="work-items-heading" className="text-sm font-semibold text-[var(--color-text-primary)]">工作事项</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {workItems.map((item) => <WorkItemCard app={taskApp} item={item} key={item.slug} />)}
      </div>
    </section>
  );
}

function WorkItemCard({ app, item }: { app?: AppItem; item: typeof workItems[number] }) {
  const tone = { blue: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]", green: "bg-[var(--color-success-soft)] text-[var(--color-success)]", amber: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]", violet: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" }[item.tone];
  const href = app ? `/${app.id}/${item.slug}` : "/";
  return <Link href={href} className="min-w-0"><div className="h-full border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] p-4 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-hover)]"><div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${tone}`}>{item.icon}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</strong><span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{app ? `${app.name} · ${item.description}` : item.description}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)]" /></div></div></Link>;
}
