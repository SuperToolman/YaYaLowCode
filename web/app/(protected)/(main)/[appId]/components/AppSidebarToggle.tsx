"use client";
import { Button } from "@heroui/react";
import { ArrowLeftToLine, ArrowRightToLine } from "@gravity-ui/icons";
import { usePathname } from "next/navigation";
import { useAppShellSidebar } from "./AppShell";
export function AppSidebarToggle({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const { collapsed, toggleCollapsed } = useAppShellSidebar();

  if (
    /\/automations(?:\/|$)/.test(pathname) ||
    /\/settings(?:\/|$)/.test(pathname)
  ) {
    return null;
  }

  return (
    <Button
      isIconOnly
      className={compact ? "h-4" : "h-9"}
      aria-label={collapsed ? "展开表单导航" : "收纳表单导航"}
      onPress={toggleCollapsed}
    >
      <span className="inline-flex">
        {collapsed ? <ArrowRightToLine /> : <ArrowLeftToLine />}
      </span>
    </Button>
  );
}
