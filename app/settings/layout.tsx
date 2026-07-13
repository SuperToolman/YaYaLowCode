"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@heroui/react/card";

const settingsGroups = [
  {
    label: "平台设置",
    items: [
      {
        href: "/settings/database",
        label: "数据库连接",
        description: "PostgreSQL 连接与凭据",
      },
    ],
  },
  {
    label: "Agent",
    items: [
      {
        href: "/settings/agent",
        label: "模型配置",
        description: "供应商、模型与执行参数",
      },
      {
        href: "/settings/knowledge",
        label: "知识库",
        description: "文档与向量检索",
      },
      {
        href: "/settings/skills",
        label: "Skills",
        description: "能力与工具权限",
      },
    ],
  },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="theme-page-shell h-full min-h-0 overflow-hidden">
      <main className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col px-4 py-5 sm:px-6">
        <section className="theme-panel-strong shrink-0 rounded-[28px] p-6 shadow-[var(--shadow-panel)]">
          <p className="text-xs font-semibold tracking-[0.14em] text-[var(--color-primary)]">
            PLATFORM SETTINGS
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--color-text-primary)]">设置</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            管理平台基础设施、Agent 模型、知识库与 Skills。每个设置项目拥有独立地址，可以直接访问和分享。
          </p>
        </section>

        <div className="mt-5 flex min-h-0 flex-1 items-stretch gap-4">
          <Card className="theme-panel h-full min-h-0 w-[200px] shrink-0 overflow-hidden rounded-[22px] p-3 shadow-[var(--shadow-card)]">
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 px-3 pb-3 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-disabled)]">
                设置导航
              </div>
              <nav aria-label="设置导航" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
              {settingsGroups.map((group) => (
                <div key={group.label}>
                  <div className="mb-1.5 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={[
                            "block rounded-xl border px-3 py-2.5 transition-colors",
                            active
                              ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]"
                              : "border-transparent hover:bg-[var(--color-bg-hover)]",
                          ].join(" ")}
                        >
                          <div
                            className={[
                              "text-sm font-semibold",
                              active
                                ? "text-[var(--color-primary)]"
                                : "text-[var(--color-text-primary)]",
                            ].join(" ")}
                          >
                            {item.label}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-4 text-[var(--color-text-secondary)]">
                            {item.description}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              </nav>
            </div>
          </Card>

          <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
