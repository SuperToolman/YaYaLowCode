"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@heroui/react/card";
import { ScrollShadow } from "@heroui/react";
import { useAuth } from "../../components/auth-provider";
import { PageContentLayout } from "../../components/page-content-layout";
import { Typography } from "@heroui/react";

const settingsGroups = [
  {
    label: "平台设置",
    items: [
      {
        href: "/settings/theme",
        permission: "settings.license",
        label: "偏好设置",
        description: "主题模式与界面外观",
      },
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
        href: "/settings/model-providers",
        permission: "settings.agent",
        label: "模型",
        description: "配置 Agent 使用的模型供应商与默认路由",
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
    <PageContentLayout title="设置" subtitle="平台配置与管理" className="min-h-0">
    <div className="h-full min-h-0 overflow-hidden">
      <main className="mx-auto grid h-full min-h-0 w-full grid-cols-[232px_minmax(0,1fr)] gap-4 overflow-hidden">
        <ScrollShadow className="h-full min-h-0 overflow-y-auto">
        <section className="flex min-h-full flex-col gap-4 overflow-hidden">
          {settingsGroups.map((group) => {
            const visibleItems = permissionsReady ? group.items.filter((item) => canView(item.permission) && (!("localOnly" in item) || !item.localOnly || deploymentType === "local")) : [];
            if (!visibleItems.length) return null;
            return (
              <Card key={group.label} className="overflow-clip">
                <Card.Header>
                  <Typography>{group.label}</Typography>
                </Card.Header>
                <Card.Content>
                  {visibleItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={item.description}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "flex flex-col justify-center px-2.5 rounded-xl",
                          active
                            ? "bg-[var(--color-primary)] text-[var(--color-text-on-primary)]"
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
                </Card.Content>
              </Card>
            );
          })}
        </section>
        </ScrollShadow>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            {children}
          </div>
        </section>
      </main>
    </div>
    </PageContentLayout>
  );
}
