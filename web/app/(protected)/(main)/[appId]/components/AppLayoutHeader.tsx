"use client";

import { Box as LogoIcon } from "@gravity-ui/icons";
import { Card } from "@heroui/react";
import { useAppHeaderActions } from "./AppShell";
import { AppHeaderTitle } from "./AppHeaderTitle";
import { AppTopNav } from "./AppTopNav";
import { AppNavigationControls } from "./AppNavigationControls";
import { AppSectionSubtitle } from "./AppSectionSubtitle";
import { AppCurrentPageTitle } from "./AppCurrentPageTitle";

export function AppLayoutHeader({ appId, initialName }: { appId: string; initialName: string }) {
  const { setHeaderActionsTarget } = useAppHeaderActions();

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-wrap items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <AppNavigationControls />
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,var(--color-secondary),var(--color-primary-active))] text-[var(--color-text-on-primary)] shadow-[var(--shadow-success)]">
              <LogoIcon />
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
                  <AppHeaderTitle appId={appId} initialName={initialName} />
                </div>
                <p className="hidden truncate text-xs text-[var(--color-text-secondary)] sm:block">
                  <AppSectionSubtitle appId={appId} />
                </p>
              </div>
              <span className="shrink-0 text-sm text-[var(--color-text-tertiary)]">/</span>
              <div className="max-w-[min(32vw,280px)] truncate text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
                <AppCurrentPageTitle appId={appId} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AppTopNav appId={appId} />
            <div ref={setHeaderActionsTarget} className="flex items-center" />
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}
