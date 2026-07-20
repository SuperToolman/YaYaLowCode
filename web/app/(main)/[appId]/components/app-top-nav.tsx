"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AppTopNavProps = {
  appId: string;
};

export function AppTopNav({ appId }: AppTopNavProps) {
  const pathname = usePathname();
  if (/\/automations\/[^/]+$/.test(pathname)) {
    return null;
  }

  const items = [
    {
      label: "页面管理",
      href: `/${appId}`,
      active:
        !pathname.startsWith(`/${appId}/automations`) &&
        !pathname.startsWith(`/${appId}/settings`),
    },
    {
      label: "集成&自动化",
      href: `/${appId}/automations`,
      active: pathname.startsWith(`/${appId}/automations`),
    },
    {
      label: "应用设置",
      href: `/${appId}/settings`,
      active: pathname.startsWith(`/${appId}/settings`),
    },
    {
      label: "应用发布",
      href: "#",
      active: false,
    },
  ];

  return (
    <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto border-t border-[var(--color-border)] pt-2 text-sm text-[var(--color-text-secondary)] lg:order-none lg:w-auto lg:border-t-0 lg:pt-0">
      {items.map((item) => {
        const className = item.active
          ? "rounded-md bg-[var(--color-primary-soft)] px-3 py-2 font-medium text-[var(--color-text-primary)]"
          : "rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-bg-panel-soft)] hover:text-[var(--color-text-primary)]";

        return (
          <Link key={item.label} href={item.href} className={className}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
