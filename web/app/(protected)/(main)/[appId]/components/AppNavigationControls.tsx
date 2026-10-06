"use client";

import { AppBackButton } from "./AppBackButton";
import { AppSidebarToggle } from "./AppSidebarToggle";
import { useAppShellSidebar } from "./AppShell";

export function AppNavigationControls() {
  const { collapsed } = useAppShellSidebar();

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <AppBackButton compact={collapsed} />
      {collapsed ? <AppSidebarToggle compact /> : null}
    </div>
  );
}
