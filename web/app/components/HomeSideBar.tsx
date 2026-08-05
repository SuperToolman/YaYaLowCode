"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge, Dropdown } from "@heroui/react";
import {
  ArrowRight,
  Comment,
  Gear,
  House,
  Person,
  SquareListUl,
  TrashBin,
} from "@gravity-ui/icons";
import { AgentAssistantTrigger } from "./agent-assistant-trigger";
import { useAuth } from "./auth-provider";
import { WorkflowNotificationItems } from "./workflow-notification-items";
import { AppIcon } from "./app-icons";
import {
  listApps,
  type App,
} from "@/features/application/api";
import {
  listCommunicationConversations,
  type CommunicationConversationResponse,
} from "@/features/communication/api";
import { appColorToneClass, normalizeAppColorTone } from "../lib/apps";

type NavItem = {
  badgeCount?: number;
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  match: (pathname: string) => boolean;
};

const primaryNavItems: NavItem[] = [
  {
    href: "/",
    label: "首页",
    icon: House,
    match: (pathname) => pathname === "/",
  },
  {
    href: "/messages",
    label: "消息",
    icon: Comment,
    match: (pathname) => pathname.startsWith("/messages"),
  },
  {
    href: "/designer",
    label: "大纲",
    icon: SquareListUl,
    match: (pathname) => pathname.startsWith("/designer"),
  },
  {
    href: "/recycle-bin",
    label: "回收站",
    icon: TrashBin,
    match: (pathname) => pathname.startsWith("/recycle-bin"),
  },
];

const ThemeSwitcherMenu = dynamic(() => import("./theme-switcher-menu"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[68px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent px-2 text-center text-[var(--color-text-secondary)] backdrop-blur-xl">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-control-soft)]" />
      <span className="text-[11px] font-medium leading-4">加载主题</span>
    </div>
  ),
});

const secondaryNavItems: NavItem[] = [
  {
    href: "/settings",
    label: "设置",
    icon: Gear,
    match: (pathname) => pathname.startsWith("/settings"),
  },
];

export default function HomeSideBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user, permissions, permissionsReady, hasPermission } = useAuth();
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [communicationEnabled, setCommunicationEnabled] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  useEffect(() => {
    if (!permissionsReady) return;
    let cancelled = false;
    void listApps({ responseStyle: "fields" })
      .then(({ data, error }) => {
        if (!cancelled && !error && data?.code === 0 && data.data) {
          setApps(data.data);
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setAppsLoading(false); });
    return () => { cancelled = true; };
  }, [permissionsReady]);
  useEffect(() => {
    if (!permissionsReady) {
      return;
    }
    let cancelled = false;
    void fetch("/api/communication/status", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { code: number; data: { enabled?: boolean } | null };
        if (!cancelled) setCommunicationEnabled(response.ok && payload.code === 0 && payload.data?.enabled === true);
      })
      .catch(() => { if (!cancelled) setCommunicationEnabled(false); });
    return () => { cancelled = true; };
  }, [permissionsReady]);
  useEffect(() => {
    if (!permissionsReady || !communicationEnabled) return;
    let cancelled = false;
    let unavailable = false;
    const load = () => void listCommunicationConversations().then((result) => {
      const payload = result.data as { data?: CommunicationConversationResponse[] | null } | undefined;
      if (result.error || !payload?.data) {
        unavailable = true;
        if (!cancelled) setMessageUnreadCount(0);
        return;
      }
      if (!cancelled) setMessageUnreadCount(payload.data.reduce((total, item) => total + item.unreadCount, 0));
    }).catch(() => { unavailable = true; });
    load();
    const timer = window.setInterval(() => { if (!unavailable) load(); }, 30_000);
    window.addEventListener("yaya-communication-read-updated", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("yaya-communication-read-updated", load);
    };
  }, [communicationEnabled, permissionsReady]);
  const visiblePrimaryNavItems = !permissionsReady
    ? []
    : primaryNavItems.filter((item) => {
        if (item.href === "/designer") return hasPermission("designer.access");
        if (item.href === "/messages") return communicationEnabled;
        if (item.href === "/recycle-bin") return hasPermission("settings.database");
        return true;
      });
  const canUseSettings =
    permissions.includes("*") || permissions.some((permission) => permission.startsWith("settings."));
  const visibleSecondaryNavItems = !permissionsReady || !canUseSettings
    ? []
    : secondaryNavItems;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    logout();
    router.replace("/login");
  }

  return (
    <aside className="sticky top-2 z-50 hidden h-[calc(100dvh-16px)] w-[54px] shrink-0 lg:flex lg:flex-col">
      <div className="flex h-full flex-col">
        <div className="mb-4"><UserMenu user={user} onLogout={() => void handleLogout()} /></div>

        <div className="flex flex-1 flex-col justify-between">
          <div className="flex flex-col gap-2">
            <NavGroup
              apps={apps}
              appsLoading={appsLoading}
              items={visiblePrimaryNavItems.map((item) => item.href === "/messages" ? { ...item, badgeCount: messageUnreadCount } : item)}
              pathname={pathname}
            />
            {permissionsReady && hasPermission("agent.window") ? <AgentAssistantTrigger /> : null}
            <ThemeSwitcherMenu />
          </div>
          <div>
            <NavGroup items={visibleSecondaryNavItems} pathname={pathname} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function UserMenu({
  onLogout,
  user,
}: {
  onLogout: () => void;
  user: { displayName: string; username: string } | null;
}) {
  const displayName = user?.displayName ?? "当前用户";
  const initial = displayName.trim().slice(0, 1).toUpperCase() || "U";

  return (
    <div className="flex h-14 items-center justify-center">
      <Dropdown>
        <Dropdown.Trigger
          aria-label={`打开 ${displayName} 的账户菜单`}
          className="group flex h-11 w-11 items-center justify-center rounded-2xl border border-transparent bg-[var(--sidebar-active-bg)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)] backdrop-blur-xl transition-colors hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-sm font-semibold text-[var(--color-primary)]">
            {initial}
          </span>
        </Dropdown.Trigger>
        <Dropdown.Popover className="border border-[var(--color-border)] bg-transparent shadow-none">
          <Dropdown.Menu
            aria-label="账户菜单"
            className="min-w-[208px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-menu)] p-1.5 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)] backdrop-blur-2xl"
            onAction={(key) => {
              if (key === "logout") onLogout();
            }}
          >
            <Dropdown.Item id="account" textValue={displayName} className="rounded-lg text-[var(--color-text-primary)]">
              <span className="flex items-center gap-3 py-1">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                  <Person className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{displayName}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">{user?.username ?? "已登录"}</span>
                </span>
              </span>
            </Dropdown.Item>
            <WorkflowNotificationItems />
            <Dropdown.Item id="logout" textValue="退出登录" className="rounded-lg text-[var(--color-danger)] data-[hover=true]:bg-[var(--color-danger-soft)]">
              <span className="flex items-center gap-3"><LogoutIcon /><span>退出登录</span></span>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

function LogoutIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3" /><path d="M10 12h11m-3-3 3 3-3 3" /></svg>;
}

function NavGroup({
  apps = [],
  appsLoading = false,
  items,
  pathname,
}: {
  apps?: App[];
  appsLoading?: boolean;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <nav className="flex flex-col gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.match(pathname);

        const navLink = (
          <Link
            href={item.href}
            title={item.label}
            aria-current={isActive ? "page" : undefined}
            className={[
              "group flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-center transition-all duration-200 backdrop-blur-xl",
              isActive
                ? "border-[var(--sidebar-soft-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-primary)] shadow-[var(--shadow-sm)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            <span className="relative">
              <span
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                  isActive
                    ? "bg-[var(--color-control-selected)] text-[var(--color-primary)]"
                    : "bg-[var(--color-control-soft)] text-[var(--color-text-secondary)] group-hover:bg-[var(--color-control-soft-hover)] group-hover:text-[var(--color-text-primary)]",
                ].join(" ")}
              >
                <Icon className="h-5 w-5" />
              </span>
              {item.badgeCount ? <Badge color="danger" size="sm" className="absolute -right-1 -top-1">{item.badgeCount > 99 ? "99+" : item.badgeCount}</Badge> : null}
            </span>
            <span className="text-[11px] font-medium leading-4">{item.label}</span>
          </Link>
        );

        if (item.href !== "/") return <div key={item.label}>{navLink}</div>;

        return (
          <div key={item.label} className="group/home relative">
            {navLink}
            <div className="pointer-events-none absolute left-full top-0 z-[60] w-[184px] translate-x-1 pl-1.5 opacity-0 transition-[opacity,transform] duration-150 group-hover/home:pointer-events-auto group-hover/home:translate-x-0 group-hover/home:opacity-100 group-focus-within/home:pointer-events-auto group-focus-within/home:translate-x-0 group-focus-within/home:opacity-100">
              <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-menu)] shadow-[var(--shadow-floating)] backdrop-blur-2xl">
                <div className="max-h-[min(360px,calc(100dvh-32px))] overflow-y-auto p-1">
                  {appsLoading ? (
                    <p className="px-2 py-3 text-center text-[11px] text-[var(--color-text-secondary)]">正在加载应用…</p>
                  ) : apps.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[11px] text-[var(--color-text-secondary)]">暂无可访问的应用</p>
                  ) : apps.map((app) => {
                    const colorClass = appColorToneClass[normalizeAppColorTone(app.color)];
                    return (
                      <a
                        key={app.id}
                        href={`/${app.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/app flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]"
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md [&>svg]:h-4 [&>svg]:w-4 ${colorClass}`}>
                          <AppIcon type={app.icon} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text-primary)]">{app.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)] transition-transform group-hover/app:translate-x-0.5 group-hover/app:text-[var(--color-primary)]" />
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
