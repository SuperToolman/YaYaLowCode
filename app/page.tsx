import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  Clock,
  FilePlus,
  Rocket,
  Sparkles,
} from "@gravity-ui/icons";
import { AppIcon } from "./components/app-icons";
import {
  appColorToneClass,
  appStatusLabel,
  appStatusTone,
  apps,
  quickActions,
} from "./lib/apps";

const actionHref: Record<string, string> = {
  创建应用: "/myApp",
  应用迁移: "/myApp",
  开始迁移: "/myApp",
  依赖修复: "/myApp",
};

const summaryCards = [
  { label: "活跃应用", value: "13", hint: "正在运行", tone: "blue" as const },
  { label: "自动化任务", value: "26", hint: "今日执行", tone: "violet" as const },
  { label: "数据记录", value: "2.1k", hint: "累计沉淀", tone: "green" as const },
];

const activityFeed = [
  {
    title: "供应链协同平台",
    detail: "昨日新增 3 条审批流并同步到测试环境",
    time: "10 分钟前",
  },
  {
    title: "MES 接口建设",
    detail: "表单 schema 已更新到 v12，等待联调验证",
    time: "32 分钟前",
  },
  {
    title: "库存预警中心",
    detail: "自动化运行成功率保持 98.6%",
    time: "1 小时前",
  },
];

const recentApps = [...apps]
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  .slice(0, 6);

export default function Home() {
  return (
    <div className="theme-page-shell">
      <main className="space-y-5 px-4 py-5 sm:px-6">
        <section className="theme-panel-strong rounded-[28px] p-6 shadow-[var(--shadow-panel)]">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_340px]">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--color-primary)]">
                <Sparkles className="h-3.5 w-3.5" />
                丫丫 LowCode 工作台
              </div>

              <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight text-[var(--color-text-primary)] sm:text-4xl">
                用更少的点击，进入你今天真正要处理的应用。
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
                左侧导航已经承担了平台切换，首页只保留总览、快捷操作和近期上下文，避免重复导航和无效信息占位。
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                {quickActions.slice(0, 3).map((action) => (
                  <Link
                    key={action.label}
                    href={actionHref[action.label] ?? "/myApp"}
                    className={[
                      "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-all",
                      action.variant === "primary"
                          ? "bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]"
                        : action.variant === "success"
                          ? "bg-[var(--color-secondary)] text-[var(--color-text-primary)] hover:opacity-90"
                          : "theme-panel text-[var(--color-text-primary)] hover:bg-[var(--color-bg-panel-soft)]",
                    ].join(" ")}
                  >
                    <FilePlus className="h-4 w-4" />
                    {action.label}
                    </Link>
                ))}
              </div>

              <div className="mt-8 grid gap-4 border-t border-[var(--color-border)] pt-6 sm:grid-cols-3">
                {summaryCards.map((card) => (
                  <SummaryCard
                    key={card.label}
                    hint={card.hint}
                    label={card.label}
                    tone={card.tone}
                    value={card.value}
                  />
                ))}
              </div>
            </div>

            <aside className="flex flex-col justify-between border-l border-[var(--color-border)] pl-0 xl:pl-8">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                    今日状态
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    最近变更与运行健康度
                  </div>
                </div>
                <CircleCheck className="h-5 w-5 text-[var(--color-secondary)]" />
              </div>

              <div className="mt-5 divide-y divide-[var(--color-border)]">
                {activityFeed.map((item) => (
                  <article key={item.title} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                          {item.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                          {item.detail}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)]">
                        {item.time}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="theme-panel-strong rounded-[24px] p-5 shadow-[var(--shadow-card)]">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="min-w-0">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    最近应用
                  </h2>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    保留最常访问的应用入口，直接继续工作。
                  </p>
                </div>
                <Link
                  href="/myApp"
                  className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-primary)]"
                >
                  进入应用中心
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-4 divide-y divide-[var(--color-border)]">
                {recentApps.length > 0 ? (
                  recentApps.map((app) => (
                    <Link
                      key={app.id}
                      href={`/${app.id}`}
                      className="group flex items-center gap-4 py-4 first:pt-0 last:pb-0"
                    >
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${appColorToneClass[app.color]}`}
                      >
                        <AppIcon type={app.icon} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <strong className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {app.name}
                          </strong>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${appStatusTone[app.status]}`}
                          >
                            {appStatusLabel[app.status]}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--color-text-secondary)]">
                          {app.desc}
                        </p>
                      </div>
                      <div className="hidden shrink-0 text-right text-xs text-[var(--color-text-secondary)] sm:block">
                        <div>{app.owner}</div>
                        <div className="mt-1">{app.records} 条数据</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)] transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ))
                ) : (
                  <div className="py-5 text-sm text-[var(--color-text-secondary)]">
                    当前还没有应用数据。可以先进入应用中心创建一个应用。
                  </div>
                )}
              </div>
            </section>

            <aside className="border-t border-[var(--color-border)] pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  快捷入口
                </h2>
                <Rocket className="h-5 w-5 text-[var(--color-primary)]" />
              </div>

              <div className="mt-4 space-y-1">
                <QuickLink
                  href="/myApp"
                  label="查看全部应用"
                  description="管理应用、状态与负责人"
                />
                <QuickLink
                  href="/myApp"
                  label="创建新应用"
                  description="从空白应用开始搭建"
                />
                <QuickLink
                  href="/designer"
                  label="进入设计器"
                  description="继续编辑表单与页面"
                />
                <QuickLink
                  href="/settings"
                  label="打开设置"
                  description="调整偏好与系统配置"
                />
              </div>

              <div className="mt-5 border-t border-[var(--color-border)] pt-4">
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Clock className="h-4 w-4" />
                  最近同步于今天 09:42
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}

function SummaryCard({
  hint,
  label,
  tone,
  value,
}: {
  hint: string;
  label: string;
  tone: "blue" | "green" | "violet";
  value: string;
}) {
  const toneClassName = {
    blue: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
    green: "bg-[var(--color-secondary-soft)] text-[var(--color-secondary)]",
    violet: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  }[tone];

  return (
    <article className="min-w-0">
      <div className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold leading-none text-[var(--color-text-primary)]">
          {value}
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${toneClassName}`}>
          {hint}
        </span>
      </div>
    </article>
  );
}

function QuickLink({
  description,
  href,
  label,
}: {
  description: string;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl px-1 py-3 transition-colors"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
        <ArrowRight className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
          {label}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
          {description}
        </span>
      </span>
    </Link>
  );
}
