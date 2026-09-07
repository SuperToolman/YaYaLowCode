"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck } from "@gravity-ui/icons";
import { MySurface } from "./my-surface";
import type { AppItem } from "../lib/apps";

const workItems = [{ slug: "tasks", label: "任务", description: "待我处理、我处理的、我创建的和抄送我的事项", icon: <CircleCheck />, tone: "blue" }] as const;

export function HomeQuickAccess({ apps }: { apps: AppItem[] }) {
  const taskApp = apps[0];
  return (
    <section aria-label="任务快捷入口" className="pb-4">
      <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {workItems.map((item) => <WorkItemCard app={taskApp} item={item} key={item.slug} />)}
      </div>
    </section>
  );
}

function WorkItemCard({ app, item }: { app?: AppItem; item: typeof workItems[number] }) {
  const href = app ? `/${app.id}/${item.slug}` : "/";
  return <MySurface className="group min-w-0 transition-colors hover:bg-default/70"><Link href={href} className="flex min-h-20 items-start gap-3 p-4"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">{item.icon}</span><span className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-foreground">{item.label}</h3><p className="mt-1 truncate text-xs text-muted">{app ? `${app.name} · ${item.description}` : item.description}</p></span><ArrowRight className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" /></Link></MySurface>;
}
