"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@heroui/react/card";
import { PageHeader } from "../components/page-header";

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
    label: "权限中心",
    items: [
      {
        href: "/settings/identity-source",
        label: "身份源设置",
        description: "平台账号或钉钉组织",
      },
      {
        href: "/settings/organization",
        label: "组织架构",
        description: "部门与组织层级",
      },
      {
        href: "/settings/roles",
        label: "角色管理",
        description: "角色与权限范围",
      },
      {
        href: "/settings/users",
        label: "用户管理",
        description: "账号、状态与归属",
      },
      {
        href: "/settings/permissions",
        label: "权限设置",
        description: "按角色分配 RBAC 权限",
      },
    ],
  },
  {
    label: "Agent",
    items: [
      {
        href: "/settings/agents",
        label: "机器人",
        description: "多 Agent 与专属能力",
      },
      {
        href: "/settings/model-providers",
        label: "模型提供商",
        description: "API、网关与密钥",
      },
      {
        href: "/settings/agent-profiles",
        label: "配置文件",
        description: "模型与执行参数组合",
      },
      {
        href: "/settings/knowledge",
        label: "知识库",
        description: "文档与向量检索",
      },
      {
        href: "/settings/plugins",
        label: "插件",
        description: "扩展入口与确认策略",
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
      <main className="mx-auto grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)]">
        <PageHeader title="设置" description="管理平台基础设施、用户权限与 Agent 能力。每个设置项目拥有独立地址，可以直接访问和分享。" />

        <div className="mt-5 flex min-h-0 overflow-hidden gap-4">
          <Card className="theme-panel h-full min-h-0 w-[200px] shrink-0 overflow-hidden p-3 shadow-[var(--shadow-card)]">
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
