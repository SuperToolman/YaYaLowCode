"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@heroui/react/card";
import { PageHeader } from "../components/page-header";
import { useAuth } from "../components/auth-provider";

const settingsGroups = [
  {
    label: "平台设置",
    items: [
      {
        href: "/settings/database",
        permission: "settings.database",
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
        permission: "settings.identity-source",
        label: "身份源设置",
        description: "平台账号或钉钉组织",
      },
      {
        href: "/settings/organization",
        permission: "settings.organization",
        label: "组织架构",
        description: "部门与组织层级",
      },
      {
        href: "/settings/roles",
        permission: "settings.roles",
        label: "角色管理",
        description: "角色与权限范围",
      },
      {
        href: "/settings/users",
        permission: "settings.users",
        label: "用户管理",
        description: "账号、状态与归属",
      },
      {
        href: "/settings/permissions",
        permission: "settings.roles",
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
        permission: "settings.agent",
        label: "机器人",
        description: "多 Agent 与专属能力",
      },
      {
        href: "/settings/model-providers",
        permission: "settings.agent",
        label: "模型提供商",
        description: "API、网关与密钥",
      },
      {
        href: "/settings/agent-profiles",
        permission: "settings.agent",
        label: "配置文件",
        description: "模型与执行参数组合",
      },
      {
        href: "/settings/knowledge",
        permission: "settings.agent",
        label: "知识库",
        description: "文档与向量检索",
      },
      {
        href: "/settings/plugins",
        permission: "settings.agent",
        label: "插件",
        description: "扩展入口与确认策略",
      },
      {
        href: "/settings/skills",
        permission: "settings.agent",
        label: "Skills",
        description: "能力与工具权限",
      },
    ],
  },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions, permissionsReady } = useAuth();
  const canView = (permission: string) => permissions.includes("*") || permissions.includes(permission);

  return (
    <div className="theme-page-shell h-full min-h-0 overflow-hidden">
      <main className="mx-auto grid h-full min-h-0 w-full grid-cols-[232px_minmax(0,1fr)] gap-4">
          <Card className="theme-panel min-h-0 overflow-hidden p-2.5 shadow-[var(--shadow-card)]">
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-3 text-xs font-semibold text-[var(--color-text-secondary)]">
                设置
              </div>
              <nav aria-label="设置导航" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-1.5 py-4">
              {settingsGroups.map((group) => {
                const visibleItems = permissionsReady ? group.items.filter((item) => canView(item.permission)) : [];
                if (!visibleItems.length) return null;
                return (
                <section key={group.label} className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                  <div className="border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-3 py-2">
                    <h2 className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      {group.label}
                    </h2>
                  </div>
                  <div className="p-1">
                    {visibleItems.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={item.description}
                          aria-current={active ? "page" : undefined}
                          className={[
                            "flex min-h-11 flex-col justify-center rounded-md px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
                            active
                              ? "bg-[var(--color-primary)] text-[var(--color-text-on-primary)] shadow-[var(--shadow-xs)]"
                              : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]",
                          ].join(" ")}
                        >
                          <span className="truncate text-sm font-medium">{item.label}</span>
                          <span className={active ? "mt-0.5 truncate text-[11px] text-[var(--color-text-on-primary)]/75" : "mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]"}>
                            {item.description}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
                );
              })}
              </nav>
            </div>
          </Card>

          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
            <PageHeader title="设置" description="管理平台基础设施、用户权限与 Agent 能力。每个设置项目拥有独立地址，可以直接访问和分享。" />
            <div className="min-h-0 flex-1 overflow-hidden">
              {children}
            </div>
          </div>
      </main>
    </div>
  );
}
