import Link from "next/link";
import {
  ArrowRight,
  ChartColumn,
  CircleCheck,
  CircleExclamation,
  Clock,
  Code,
  Database,
  FilePlus,
  FolderOpen,
  Rocket,
} from "@gravity-ui/icons";
import { AppIcon } from "./components/app-icons";
import { appStatusLabel, appStatusTone, apps, quickActions } from "./lib/apps";
import { PlatformHeader } from "./(main)/components/platform-header";

const stats = [
  { label: "运行应用", value: "13", trend: "+4 本月", tone: "text-[#2f6bff]" },
  { label: "待办任务", value: "26", trend: "8 项临近", tone: "text-[#d97706]" },
  { label: "流程实例", value: "1,284", trend: "98.6% 正常", tone: "text-[#17b466]" },
  { label: "数据记录", value: "2.1k", trend: "+18.2%", tone: "text-[#b4237a]" },
];

const tasks = [
  {
    title: "研发项目立项审批",
    app: "丫丫研发中心",
    due: "今天 14:00",
    status: "待处理",
    tone: "bg-[#fff8e1] text-[#9a6700]",
  },
  {
    title: "库存预警确认",
    app: "丫丫仓储管理",
    due: "今天 16:30",
    status: "高优先级",
    tone: "bg-[#fff0f3] text-[#c73655]",
  },
  {
    title: "销售交付成本复核",
    app: "丫丫销售交付",
    due: "明天 10:00",
    status: "协同",
    tone: "bg-[#edf4ff] text-[#2f6bff]",
  },
];

const templates = [
  { name: "项目进度看板", icon: ChartColumn, color: "bg-[#edf4ff] text-[#2f6bff]" },
  { name: "采购申请流程", icon: FilePlus, color: "bg-[#fff3e8] text-[#cf6f22]" },
  { name: "数据字典维护", icon: Database, color: "bg-[#eefbf3] text-[#16844d]" },
  { name: "接口集成任务", icon: Code, color: "bg-[#f2f0ff] text-[#6157d8]" },
];

const actionHref: Record<string, string> = {
  创建应用: "/myApp",
  应用迁移: "/myApp",
  开始迁移: "/myApp",
  依赖修复: "/myApp",
};

const recentApps = [...apps]
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  .slice(0, 6);

export default function Home() {
  const enabledCount = apps.filter((app) => app.status === "enabled").length;
  const draftCount = apps.filter((app) => app.status === "draft").length;

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-[#14213d]">
      <PlatformHeader active="home" />
      <main className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="hidden lg:block">
          <div className="sticky top-[84px] space-y-4">
            <section className="rounded-lg border border-[#dfe7f3] bg-white p-3 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
              <div className="px-2 pb-2 text-xs font-semibold text-[#7587a3]">
                平台导航
              </div>
              <SidebarLink active href="/" label="工作台" icon={<FolderOpen />} />
              <SidebarLink href="/myApp" label="我的应用" icon={<Rocket />} />
              <SidebarLink href="/myApp" label="数据资产" icon={<Database />} />
            </section>

            <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">企业空间</span>
                <span className="rounded-md bg-[#edf4ff] px-2 py-1 text-xs font-medium text-[#2f6bff]">
                  Pro
                </span>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <SpaceLine label="已启用" value={`${enabledCount} 个`} />
                <SpaceLine label="草稿应用" value={`${draftCount} 个`} />
                <SpaceLine label="成员" value="48 人" />
              </div>
            </section>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <section className="rounded-lg border border-[#d9e5f5] bg-white p-5 shadow-[0_16px_40px_rgba(20,33,61,0.06)]">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <p className="text-sm font-medium text-[#4f6484]">
                  丫丫数字化工作台
                </p>
                <h1 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight text-[#14213d] sm:text-4xl">
                  从待办、应用到流程运行，统一推进业务数字化。
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f718e]">
                  聚合企业应用、数据表单、审批流和自动化任务，保持和宜搭相近的工作台入口结构。
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  {quickActions.map((action) => (
                    <Link
                      key={action.label}
                      href={actionHref[action.label] ?? "/myApp"}
                      className={[
                        "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
                        action.variant === "primary"
                          ? "bg-[#2f6bff] text-white hover:bg-[#245be6]"
                          : action.variant === "success"
                            ? "bg-[#17b466] text-white hover:bg-[#149b59]"
                            : "border border-[#d7e2f1] bg-white text-[#263a5c] hover:bg-[#f6f9fe]",
                      ].join(" ")}
                    >
                      <FilePlus className="h-4 w-4" />
                      {action.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#dfe7f3] bg-[#f8fbff] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">今日流程健康度</p>
                    <p className="mt-1 text-xs text-[#7587a3]">运行实例与异常分布</p>
                  </div>
                  <CircleCheck className="h-5 w-5 text-[#17b466]" />
                </div>
                <div className="mt-5 grid h-24 grid-cols-12 items-end gap-1.5">
                  {[42, 58, 36, 74, 68, 92, 54, 80, 62, 88, 70, 96].map(
                    (height, index) => (
                      <span
                        key={index}
                        className="rounded-t bg-[#2f6bff]"
                        style={{ height: `${height}%`, opacity: 0.38 + index * 0.035 }}
                      />
                    ),
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-[#dfe7f3] pt-3 text-xs text-[#7587a3]">
                  <span>正常 1,266</span>
                  <span>异常 18</span>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((item) => (
              <article
                key={item.label}
                className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]"
              >
                <p className="text-sm text-[#7587a3]">{item.label}</p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <strong className="text-3xl font-semibold text-[#14213d]">
                    {item.value}
                  </strong>
                  <span className={`text-sm font-medium ${item.tone}`}>
                    {item.trend}
                  </span>
                </div>
              </article>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">最近应用</h2>
                  <p className="mt-1 text-sm text-[#7587a3]">
                    按最近创建时间排序
                  </p>
                </div>
                <Link
                  href="/myApp"
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#2f6bff]"
                >
                  全部应用
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {recentApps.map((app) => (
                  <Link
                    key={app.id}
                    href={`/${app.id}`}
                    className="group rounded-lg border border-[#e3ebf6] bg-white p-4 transition-colors hover:border-[#aac5ff] hover:bg-[#f8fbff]"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${app.color}`}
                      >
                        <AppIcon type={app.icon} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <strong className="truncate text-sm font-semibold text-[#14213d]">
                            {app.name}
                          </strong>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${appStatusTone[app.status]}`}
                          >
                            {appStatusLabel[app.status]}
                          </span>
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[#6f8098]">
                          {app.desc}
                        </span>
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-[#7587a3]">
                      <span>{app.owner}</span>
                      <span>{app.records} 条数据</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">我的待办</h2>
                <Clock className="h-5 w-5 text-[#7587a3]" />
              </div>
              <div className="mt-4 space-y-3">
                {tasks.map((task) => (
                  <article
                    key={task.title}
                    className="rounded-lg border border-[#e3ebf6] bg-[#fbfdff] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">
                          {task.title}
                        </h3>
                        <p className="mt-1 text-xs text-[#7587a3]">{task.app}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${task.tone}`}
                      >
                        {task.status}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-[#6f8098]">
                      <CircleExclamation className="h-4 w-4 text-[#d97706]" />
                      {task.due}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">推荐模板</h2>
              <Rocket className="h-5 w-5 text-[#2f6bff]" />
            </div>
            <div className="mt-4 grid gap-3">
              {templates.map((template) => {
                const Icon = template.icon;

                return (
                  <Link
                    key={template.name}
                    href="/designer/new-page"
                    className="flex items-center gap-3 rounded-lg border border-[#e3ebf6] p-3 transition-colors hover:bg-[#f8fbff]"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${template.color}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {template.name}
                    </span>
                    <ArrowRight className="h-4 w-4 text-[#9aa9be]" />
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
            <h2 className="text-lg font-semibold">自动化概览</h2>
            <div className="mt-4 space-y-4">
              <ProgressRow label="审批自动分派" value={82} color="bg-[#2f6bff]" />
              <ProgressRow label="库存预警触达" value={64} color="bg-[#17b466]" />
              <ProgressRow label="数据同步成功" value={91} color="bg-[#b4237a]" />
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function SidebarLink({
  active = false,
  href,
  icon,
  label,
}: {
  active?: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={[
        "mt-1 flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-[#edf4ff] text-[#2f6bff]"
          : "text-[#4f6484] hover:bg-[#f6f9fe] hover:text-[#14213d]",
      ].join(" ")}
    >
      <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      {label}
    </Link>
  );
}

function SpaceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#7587a3]">{label}</span>
      <span className="font-medium text-[#14213d]">{value}</span>
    </div>
  );
}

function ProgressRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-[#7587a3]">{value}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#edf2f7]">
        <span
          className={`block h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
