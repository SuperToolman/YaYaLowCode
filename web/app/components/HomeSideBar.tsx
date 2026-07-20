"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import {
  Gear,
  House,
  LayoutHeaderCellsLarge,
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
    match: (pathname) => pathname.startsWith("/myApp") || /^\/[^/]+$/.test(pathname),
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
    <div className="flex min-h-[72px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-transparent px-2 py-3 text-center text-[var(--color-text-secondary)] backdrop-blur-xl">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-control-soft)]" />
      <span className="text-[11px] font-medium leading-4">主题</span>
      <span className="text-[10px] text-[var(--color-text-disabled)]">加载中</span>
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
        <div className="flex h-14 items-center justify-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--sidebar-active-bg)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)] backdrop-blur-xl">
            <span className="text-sm font-semibold tracking-[0.18em]">YY</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-between">
          <NavGroup items={primaryNavItems} pathname={pathname} />
          <div className="flex flex-col gap-3">
            <AgentAssistantLauncher />
            <ThemeSwitcherMenu />
            <NavGroup items={secondaryNavItems} pathname={pathname} />
            <button
              type="button"
              title={user ? `退出 ${user.displayName}` : "退出登录"}
              aria-label="退出登录"
              className="group flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent text-center text-[var(--color-text-secondary)] transition-all duration-200 backdrop-blur-xl hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-danger)]"
              onClick={() => void handleLogout()}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-control-soft)] transition-colors group-hover:bg-[var(--color-danger-soft)]">
                <LogoutIcon />
              </span>
              <span className="text-[11px] font-medium leading-4">退出</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3" />
      <path d="M10 12h11m-3-3 3 3-3 3" />
    </svg>
  );
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
              "group flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border text-center transition-all duration-200 backdrop-blur-xl",
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
            <span className="text-xs font-medium leading-4">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
