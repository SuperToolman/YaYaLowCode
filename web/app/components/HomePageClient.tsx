"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CircleCheck } from "@gravity-ui/icons";
import { Card } from "@heroui/react";
import type { AppItem } from "../lib/apps";
import { normalizeAppColorTone } from "../lib/apps";
import { listApps, type App } from "@/features/application/api";
import { PageContentLayout } from "./PageContentLayout";

const workItems = [{ slug: "tasks", label: "任务", description: "待我处理、我处理的、我创建的和抄送我的事项", icon: <CircleCheck />, tone: "blue" }] as const;

export function HomePageClient({ initialApps }: { initialApps: AppItem[] }) {
  const [apps, setApps] = useState(initialApps);

  useEffect(() => {
    void listApps({ responseStyle: "fields" }).then(({ data, error }) => {
      if (!error && data?.code === 0 && data.data) setApps(data.data.map(toAppItem));
    }).catch(() => undefined);
  }, []);

  return (
    <PageContentLayout title="工作台" subtitle="常用工作入口。">
      <main className="flex h-full min-h-0 flex-col">
        <HomeQuickAccess apps={apps} />
      </main>
    </PageContentLayout>
  );
}

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
  return (
    <Card>
      <Link href={href} className="flex min-h-20 items-start gap-3">
        <Card.Content className="flex min-w-0 flex-1 items-start gap-3">
          <span>{item.icon}</span>
          <span className="min-w-0 flex-1"><Card.Title>{item.label}</Card.Title><Card.Description className="truncate">{app ? `${app.name} · ${item.description}` : item.description}</Card.Description></span>
          <ArrowRight />
        </Card.Content>
      </Link>
    </Card>
  );
}

function toAppItem(app: App): AppItem {
  return {
    ...app,
    deploymentType: app.deploymentType === "online" ? "online" : "local",
    badge: app.badge ?? undefined,
    color: normalizeAppColorTone(app.color),
  };
}
