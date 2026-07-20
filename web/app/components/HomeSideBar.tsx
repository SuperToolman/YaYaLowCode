"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Dropdown } from "@heroui/react";
import {
  Gear,
  House,
  LayoutHeaderCellsLarge,
  Person,
  SquareListUl,
} from "@gravity-ui/icons";
import AgentAssistantLauncher from "./agent-assistant-launcher";
import { useAuth } from "./auth-provider";

type NavItem = {
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
    href: "/myApp",
    label: "应用",
    icon: LayoutHeaderCellsLarge,
    match: (pathname) =>
      pathname.startsWith("/myApp") ||
      (/^\/[^/]+$/.test(pathname) && !["/designer", "/settings", "/login"].includes(pathname)),
  },
  {
    href: "/designer",
    label: "大纲",
    icon: SquareListUl,
    match: (pathname) => pathname.startsWith("/designer"),
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
  const { logout, user } = useAuth();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    logout();
    router.replace("/login");
  }

  return (
    <aside className="sticky top-2 hidden h-[calc(100dvh-16px)] w-[54px] shrink-0 lg:flex lg:flex-col">
      <div className="flex h-full flex-col">
        <div className="mb-4"><UserMenu user={user} onLogout={() => void handleLogout()} /></div>

        <div className="flex flex-1 flex-col justify-between">
          <div className="flex flex-col gap-2">
            <NavGroup items={primaryNavItems} pathname={pathname} />
            <AgentAssistantLauncher />
            <ThemeSwitcherMenu />
          </div>
          <div>
            <NavGroup items={secondaryNavItems} pathname={pathname} />
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
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}) {
  return (
    <nav className="flex flex-col gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.match(pathname);

        return (
          <Link
            key={item.label}
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
            <span className="text-[11px] font-medium leading-4">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
