"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  Gear,
  House,
  LayoutHeaderCellsLarge,
  SquareListUl,
} from "@gravity-ui/icons";

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
    label: "我的应用",
    icon: LayoutHeaderCellsLarge,
    match: (pathname) => pathname.startsWith("/myApp") || /^\/[^/]+$/.test(pathname),
  },
  {
    href: "/designer",
    label: "字段大纲",
    icon: SquareListUl,
    match: (pathname) => pathname.startsWith("/designer"),
  },
];

const ThemeSwitcherMenu = dynamic(() => import("./theme-switcher-menu"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[72px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-transparent px-2 py-3 text-center text-[var(--text-secondary)] backdrop-blur-xl">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(255,255,255,0.08)]" />
      <span className="text-[11px] font-medium leading-4">主题</span>
      <span className="text-[10px] text-[var(--text-subtle)]">加载中</span>
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

  return (
    <aside className="sticky top-0 hidden h-[calc(100vh-24px)] w-[92px] shrink-0 lg:flex lg:flex-col">
      <div className="flex h-full flex-col px-3 py-4">
        <div className="flex h-14 items-center justify-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--sidebar-active-bg)] text-[var(--text-primary)] shadow-[0_14px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl">
            <span className="text-sm font-semibold tracking-[0.18em]">YY</span>
          </div>
        </div>

        <div className="mt-6 flex flex-1 flex-col justify-between">
          <NavGroup items={primaryNavItems} pathname={pathname} />
          <div className="flex flex-col gap-3">
            <ThemeSwitcherMenu />
            <NavGroup items={secondaryNavItems} pathname={pathname} />
          </div>
        </div>
      </div>
    </aside>
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
              "group flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-center transition-all duration-200 backdrop-blur-xl",
              isActive
                ? "border-[var(--sidebar-soft-border)] bg-[var(--sidebar-active-bg)] text-[var(--brand-blue)] shadow-[0_14px_34px_rgba(0,0,0,0.08)]"
                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            <span
              className={[
                "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                isActive
                  ? "bg-[rgba(255,255,255,0.24)] text-[var(--brand-blue)]"
                  : "bg-[rgba(255,255,255,0.08)] text-[var(--text-secondary)] group-hover:bg-[rgba(255,255,255,0.18)] group-hover:text-[var(--text-primary)]",
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
