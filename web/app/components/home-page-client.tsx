"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@heroui/react";
import {
  ArrowRight,
  CircleCheck,
  Clock,
  File,
  FilePlus,
  Gear,
  LayoutHeaderCellsLarge,
  Plus,
  Rocket,
} from "@gravity-ui/icons";
import { listApps, type App as ApiApp } from "../lib/api-client";
import { useAuth } from "./auth-provider";
import { PageHeader } from "./page-header";
import { AppIcon } from "./app-icons";
import { appColorToneClass, appStatusLabel, appStatusTone, normalizeAppColorTone, type AppItem } from "../lib/apps";

const RECENT_APP_STORAGE_KEY = "yaya-recent-apps";
const workItems = [
  { slug: "todo", label: "待我处理", description: "等待你处理的任务", icon: <CircleCheck />, tone: "blue" },
  { slug: "processed", label: "我处理的", description: "已完成或已处理事项", icon: <Clock />, tone: "green" },
  { slug: "created", label: "我创建的", description: "由你发起的事项", icon: <FilePlus />, tone: "amber" },
  { slug: "copied", label: "抄送我的", description: "需要知悉的通知与记录", icon: <File />, tone: "violet" },
] as const;

export function HomePageClient() {
  const { user } = useAuth();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => void (async () => {
      setRecentIds(readRecentAppIds());
      try {
        const { data, error } = await listApps({ responseStyle: "fields" });
        if (error || !data || data.code !== 0 || !data.data) throw new Error("load apps failed");
        if (!cancelled) setApps(data.data.map(toAppItem));
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })(), 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  const enabledApps = apps.filter((app) => app.status === "enabled");
  const newestApps = useMemo(() => [...apps].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4), [apps]);
  const recentApps = useMemo(() => recentIds.map((id) => apps.find((app) => app.id === id)).filter((app): app is AppItem => Boolean(app)).slice(0, 4), [apps, recentIds]);
  const taskApp = enabledApps[0] ?? apps[0];

  function recordVisit(appId: string) {
    const next = [appId, ...recentIds.filter((id) => id !== appId)].slice(0, 8);
    setRecentIds(next);
    try { window.localStorage.setItem(RECENT_APP_STORAGE_KEY, JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
  }

  return (
    <div className="theme-page-shell flex h-full min-h-0 overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full flex-col gap-4 xl:min-h-0">
        <PageHeader title={`你好，${user?.displayName || "管理员"}`} description="集中查看工作事项并继续处理你的低代码应用。" eyebrow={<><CircleCheck className="h-3.5 w-3.5" />工作台</>} actions={<><div className="grid grid-cols-3 gap-5 sm:gap-8"><HeaderMetric label="应用" value={isLoading ? "-" : String(apps.length)} /><HeaderMetric label="运行中" value={isLoading ? "-" : String(enabledApps.length)} /><HeaderMetric label="数据记录" value={isLoading ? "-" : formatCount(apps.reduce((sum, app) => sum + app.records, 0))} /></div><Link href="/myApp" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-text-on-primary)]"><Plus className="h-4 w-4" />创建应用</Link></>} />

        <section className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workItems.map((item) => <WorkItemCard app={taskApp} item={item} key={item.slug} />)}
        </section>

        <section className="grid min-h-[520px] flex-1 gap-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
          <AppListCard title="最近创建的应用" description="从最新搭建的业务应用继续工作。" apps={newestApps} emptyMessage="还没有创建应用。" isLoading={isLoading} loadFailed={loadFailed} onVisit={recordVisit} />
          <AppListCard title="最近访问的应用" description="保留你最近打开过的应用入口。" apps={recentApps} emptyMessage="暂无访问记录，打开应用后会显示在这里。" isLoading={isLoading} loadFailed={loadFailed} onVisit={recordVisit} />
          <Card className="theme-panel-strong flex min-h-0 flex-col p-5 shadow-[var(--shadow-card)]"><div className="flex items-center justify-between"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">常用操作</h2><Rocket className="h-5 w-5 text-[var(--color-primary)]" /></div><div className="mt-3 divide-y divide-[var(--color-border)]"><ActionLink href="/myApp" icon={<FilePlus />} label="新建应用" description="从空白应用开始搭建" /><ActionLink href="/designer" icon={<LayoutHeaderCellsLarge />} label="字段大纲" description="浏览表单与页面结构" /><ActionLink href="/settings" icon={<Gear />} label="系统设置" description="管理用户和平台配置" /></div><div className="mt-auto flex items-center gap-2 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-secondary)]"><Clock className="h-4 w-4" />应用数据自动同步</div></Card>
        </section>
      </main>
    </div>
  );
}

function WorkItemCard({ app, item }: { app?: AppItem; item: typeof workItems[number] }) {
  const tone = { blue: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]", green: "bg-[var(--color-success-soft)] text-[var(--color-success)]", amber: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]", violet: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" }[item.tone];
  const href = app ? `/${app.id}/${item.slug}` : "/myApp";
  return <Link href={href} className="min-w-0"><Card className="theme-panel-strong h-full p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--color-bg-hover)]"><div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${tone}`}>{item.icon}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</strong><span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{app ? `${app.name} · ${item.description}` : item.description}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)]" /></div></Card></Link>;
}

function AppListCard({ apps, description, emptyMessage, isLoading, loadFailed, onVisit, title }: { apps: AppItem[]; description: string; emptyMessage: string; isLoading: boolean; loadFailed: boolean; onVisit: (appId: string) => void; title: string }) {
  return <Card className="theme-panel-strong flex min-h-0 flex-col p-5 shadow-[var(--shadow-card)]"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p></div><Link href="/myApp" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--color-primary)]">全部 <ArrowRight className="h-4 w-4" /></Link></div>{isLoading ? <LoadingRows /> : loadFailed ? <div className="mt-4 rounded-md bg-[var(--color-warning-soft)] p-3 text-sm text-[var(--color-text-secondary)]">暂时无法读取应用数据。</div> : apps.length ? <div className="mt-4 divide-y divide-[var(--color-border)]">{apps.map((app) => <AppRow app={app} key={app.id} onVisit={onVisit} />)}</div> : <div className="mt-4 flex flex-1 items-center rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm leading-6 text-[var(--color-text-secondary)]">{emptyMessage}</div>}</Card>;
}

function AppRow({ app, onVisit }: { app: AppItem; onVisit: (appId: string) => void }) { return <Link href={`/${app.id}`} onClick={() => onVisit(app.id)} className="group flex items-center gap-3 py-3.5 first:pt-0 last:pb-0"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${appColorToneClass[app.color]}`}><AppIcon type={app.icon} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{app.name}</strong><em className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] not-italic ${appStatusTone[app.status]}`}>{appStatusLabel[app.status]}</em></span><span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{app.desc || "尚未添加应用说明"}</span></span><span className="hidden text-right text-xs text-[var(--color-text-secondary)] sm:block">{app.records} 条</span><ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)] transition-transform group-hover:translate-x-0.5" /></Link>; }
function HeaderMetric({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-[var(--color-text-secondary)]">{label}</div><strong className="mt-1 block text-xl font-semibold text-[var(--color-text-primary)]">{value}</strong></div>; }
function ActionLink({ href, icon, label, description }: { href: string; icon: React.ReactNode; label: string; description: string }) { return <Link href={href} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)] [&>svg]:h-4 [&>svg]:w-4">{icon}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</strong><span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{description}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)]" /></Link>; }
function LoadingRows() { return <div className="mt-4 space-y-3">{[0, 1, 2].map((item) => <div className="h-14 animate-pulse rounded-md bg-[var(--color-bg-panel-soft)]" key={item} />)}</div>; }
function formatCount(value: number) { return new Intl.NumberFormat("zh-CN", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function toAppItem(app: ApiApp): AppItem { return { ...app, badge: app.badge ?? undefined, color: normalizeAppColorTone(app.color) }; }
function readRecentAppIds() { try { const value = JSON.parse(window.localStorage.getItem(RECENT_APP_STORAGE_KEY) ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; } catch { return []; } }
