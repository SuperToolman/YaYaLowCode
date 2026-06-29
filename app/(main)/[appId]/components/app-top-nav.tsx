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
      active: !pathname.startsWith(`/${appId}/automations`),
    },
    {
      label: "集成&自动化",
      href: `/${appId}/automations`,
      active: pathname.startsWith(`/${appId}/automations`),
    },
    {
      label: "应用设置",
      href: "#",
      active: false,
    },
    {
      label: "应用发布",
      href: "#",
      active: false,
    },
  ];

  return (
    <nav className="hidden items-center gap-10 text-sm text-[var(--text-secondary)] lg:flex">
      {items.map((item) => {
        const className = item.active
          ? "border-b-[3px] border-[var(--brand-blue)] pb-4 text-[var(--text-primary)]"
          : "pb-4";

        return (
          <Link key={item.label} href={item.href} className={className}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
