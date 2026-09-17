"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChartMixed,
  CircleCheck,
  Gear,
  Plus,
  Rocket,
  SquareListUl,
} from "@gravity-ui/icons";
import type { AppItem } from "../lib/apps";
import { appColorToneClass, normalizeAppColorTone } from "../lib/apps";
import { listApps, type App } from "@/features/application/api";
import { useAuth } from "./AuthProvider";

const quickActions = [
  {
    label: "创建应用",
    description: "从空白或模板开始",
    href: "/myApp",
    icon: Plus,
    tone: "primary",
  },
  {
    label: "我的任务",
    description: "查看待处理事项",
    href: "/tasks",
    icon: CircleCheck,
    tone: "success",
  },
  {
    label: "数据与报表",
    description: "追踪业务运行情况",
    href: "/myApp",
    icon: ChartMixed,
    tone: "accent",
  },
] as const;

export function HomePageClient({ initialApps }: { initialApps: AppItem[] }) {
  const [apps, setApps] = useState(initialApps);
  const { user } = useAuth();
  useEffect(() => {
    void listApps({ responseStyle: "fields" })
      .then(({ data, error }) => {
        if (!error && data?.code === 0 && data.data)
          setApps(data.data.map(toAppItem));
      })
      .catch(() => undefined);
  }, []);
  const totalRecords = useMemo(
    () => apps.reduce((total, app) => total + (app.records || 0), 0),
    [apps],
  );
  const enabledApps = apps.filter((app) => app.active !== false).length;

  return (
    <main className="min-h-full overflow-y-auto px-5 pb-10 pt-6 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-primary)]">
              YAYA LOWCODE / WORKSPACE
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
              早上好，{user?.displayName ?? "朋友"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
              把想法，变成可运行的应用。连接数据、搭建表单、编排自动化，让团队每天都从重要的工作开始。
            </p>
          </div>
          <Link
            href="/myApp"
            className="group inline-flex h-10 items-center gap-2 rounded-[var(--radius)] bg-[var(--color-primary)] px-4 text-sm font-semibold text-[var(--color-text-on-primary)] shadow-[var(--shadow-sm)] transition-transform hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> 新建应用{" "}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </header>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.8fr)]">
          <div className="relative overflow-hidden rounded-[calc(var(--radius)*1.5)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-[var(--shadow-card)] sm:p-8">
            <div className="pointer-events-none absolute right-[-4rem] top-[-5rem] h-56 w-56 rounded-full border-[28px] border-[var(--color-primary-soft)] opacity-70" />
            <div className="relative max-w-xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{" "}
                工作台已就绪
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-[2rem]">
                今天，先从哪里开始？
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
                快速进入最近的应用，或者用一个空白画布开启新的业务流程。
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      href={action.href}
                      key={action.label}
                      className="group rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-canvas)] p-3 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)]"
                    >
                      <span
                        className={`mb-5 flex h-9 w-9 items-center justify-center rounded-[var(--radius)] ${appColorToneClass[action.tone]}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                        {action.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">
                        {action.description}
                      </span>
                      <ArrowRight className="mt-3 h-3.5 w-3.5 text-[var(--color-text-disabled)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-primary)]" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
          <aside className="rounded-[calc(var(--radius)*1.5)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                平台概览
              </h2>
              <Gear className="h-4 w-4 text-[var(--color-text-disabled)]" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Metric label="应用总数" value={apps.length} suffix="个" />
              <Metric label="运行中" value={enabledApps} suffix="个" />
              <Metric label="数据记录" value={totalRecords} suffix="条" />
              <Metric
                label="自动化"
                value={
                  apps.length ? Math.max(1, Math.ceil(apps.length / 2)) : 0
                }
                suffix="条"
              />
            </div>
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                <ChartMixed className="h-3.5 w-3.5" /> 近 7 日活跃度
                <span className="ml-auto text-[var(--color-success)]">+18.6%</span>
              </div>
              <div className="mt-4 flex h-16 items-end gap-1.5">
                {[34, 48, 42, 67, 54, 76, 88].map((height, index) => (
                  <div key={index} className="flex-1 rounded-t-sm bg-[var(--color-primary)] opacity-60 transition-opacity hover:opacity-100" style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-[var(--color-text-disabled)]"><span>周一</span><span>周三</span><span>周五</span><span>今天</span></div>
            </div>
          </aside>
        </section>
        <section className="mt-8" aria-labelledby="recent-apps-heading">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2
                id="recent-apps-heading"
                className="text-lg font-semibold text-[var(--color-text-primary)]"
              >
                最近使用的应用
              </h2>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                从上次停留的位置继续工作
              </p>
            </div>
            <Link
              href="/myApp"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline"
            >
              查看全部 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {apps.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {apps.slice(0, 6).map((app) => (
                <AppCard app={app} key={app.id} />
              ))}
            </div>
          ) : (
            <EmptyApps />
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3">
      <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">
        {value.toLocaleString()}
        <span className="ml-1 text-xs font-normal text-[var(--color-text-disabled)]">
          {suffix}
        </span>
      </p>
    </div>
  );
}
function AppCard({ app }: { app: AppItem }) {
  const tone = normalizeAppColorTone(app.color);
  return (
    <Link
      href={`/${app.id}`}
      className="group flex min-h-[142px] flex-col justify-between rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-[var(--shadow-xs)] transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-card)]"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-[var(--radius)] text-sm font-semibold ${appColorToneClass[tone]}`}
        >
          <SquareListUl className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-[var(--color-text-disabled)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-primary)]" />
      </div>
      <div>
        <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {app.name}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span>{app.records.toLocaleString()} 条记录</span>
          <span className="h-1 w-1 rounded-full bg-[var(--color-text-disabled)]" />
          <span>{app.active === false ? "未启用" : "运行中"}</span>
        </div>
      </div>
    </Link>
  );
}
function EmptyApps() {
  return (
    <div className="flex min-h-[210px] flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
        <Rocket className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-[var(--color-text-primary)]">
        还没有应用
      </h3>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
        创建一个应用，把第一个业务流程带进来。
      </p>
      <Link
        href="/myApp"
        className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-primary)] hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> 创建第一个应用
      </Link>
    </div>
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
