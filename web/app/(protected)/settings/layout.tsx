"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@heroui/react/card";
import { useAuth } from "../../components/auth-provider";

const settingsGroups = [
  {
    label: "平台设置",
    items: [
      {
        href: "/settings/database",
        permission: "settings.database",
        label: "数据库连接",
        description: "PostgreSQL 连接与凭据",
        localOnly: true,
      },
      {
        href: "/settings/notifications",
        permission: "settings.agent",
        label: "通知设置",
        description: "站内通知与外部渠道预留",
      },
      {
        href: "/settings/logs",
        permission: "settings.database",
        label: "平台日志",
        description: "查看平台运行与异常事件",
      },
      {
        href: "/settings/about",
        permission: "settings.license",
        label: "关于平台",
        description: "版本与许可证状态",
      },
    ],
  },
  {
    label: "权限中心",
    items: [
      {
        href: "/settings/identity-source",
        permission: "settings.identity-source",
        label: "身份源与组织架构",
        description: "平台账号、第三方身份源与组织层级",
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
    label: "AI员工",
    items: [
      {
        href: "/settings/ai-employee-market",
        permission: "settings.agent",
        label: "AI员工市场",
        description: "浏览与安装 AI 员工",
      },
      {
        href: "/settings/knowledge",
        permission: "settings.agent",
        label: "知识库",
        description: "配置 AI 员工使用的知识内容",
      },
    ],
  },
  {
    label: "通讯",
    items: [
      {
        href: "/settings/communication",
        permission: "settings.agent",
        label: "通讯设置",
        description: "安装和管理通讯模块",
      },
    ],
  },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions, permissionsReady } = useAuth();
  const [deploymentType, setDeploymentType] = useState<"saas" | "local">("saas");
  useEffect(() => {
    void fetch("/api/settings/license", { cache: "no-store" }).then((response) => response.json()).then((payload) => {
      setDeploymentType(payload.data?.deploymentType === "local" ? "local" : "saas");
    }).catch(() => setDeploymentType("saas"));
  }, []);
  const canView = (permission: string) => permissions.includes("*")
    || permissions.includes(permission)
    || (permission === "settings.identity-source" && permissions.includes("settings.organization"));

  return (
    <div className="theme-page-shell settings-page-shell h-full min-h-0 overflow-clip">
      <main className="mx-auto grid h-full min-h-0 w-full grid-cols-[232px_minmax(0,1fr)] gap-4">
          <Card className="theme-panel min-h-0 overflow-clip p-2.5 shadow-[var(--shadow-card)]">
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-3 text-xs font-semibold text-[var(--color-text-secondary)]">
                设置
              </div>
              <nav aria-label="设置导航" className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-1.5 py-4">
              {settingsGroups.map((group) => {
                const visibleItems = permissionsReady ? group.items.filter((item) => canView(item.permission) && (!("localOnly" in item) || !item.localOnly || deploymentType === "local")) : [];
                if (!visibleItems.length) return null;
                return (
                <section key={group.label} className="overflow-clip rounded-lg border border-[var(--color-border)]">
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

          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-clip">
            <div className="min-h-0 flex-1 overflow-clip">
              {children}
            </div>
          </div>
      </main>
    </div>
  );
}
