import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft as ArrowLeftIcon, Box as LogoIcon } from "@gravity-ui/icons";
import {
  getAppByRouteId,
  normalizeAppColorTone,
  type AppItem,
} from "@lib/apps";
import { AppMainContent, AppShell } from "./components/AppShell";
import { AppSidebarToggle } from "./components/AppSidebarToggle";
import { AppHeaderTitle } from "./components/AppHeaderTitle";
import { AppTopNav } from "./components/AppTopNav";
import { FormSidebar } from "./components/FormSidebar";
import { getRuntimeApp } from "@features/application/server-api";
import {
  Button,
  Card,
  Input,
  ListBox,
  Select,
  Switch,
  TextArea,
  toast,
} from "@heroui/react";

export default async function AppLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ appId: string }>;
}>) {
  const { appId: routeAppId } = await params;
  const app = await loadApp(routeAppId);

  if (!app) {
    notFound();
  }

  return (
    <div className="theme-page-shell min-h-0 flex-1 overflow-hidden">
      <AppShell sidebar={<FormSidebar routeAppId={routeAppId} />}>
        <Card>
          <Card.Content>
            <div className="flex flex-wrap items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                <Link
                  href="/"
                  aria-label="返回我的应用"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-subtle)]"
                >
                  <ArrowLeftIcon />
                </Link>
                <AppSidebarToggle />
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,var(--color-secondary),var(--color-primary-active))] text-[var(--color-text-on-primary)] shadow-[var(--shadow-success)]">
                  <LogoIcon />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
                    <AppHeaderTitle appId={routeAppId} initialName={app.name} />
                  </div>
                  <p className="hidden truncate text-xs text-[var(--color-text-secondary)] sm:block">
                    应用工作台
                  </p>
                </div>
              </div>

              <div className="flex items-center">
                <AppTopNav appId={routeAppId} />
              </div>
            </div>
          </Card.Content>
        </Card>
        <AppMainContent>{children}</AppMainContent>
      </AppShell>
    </div>
  );
}

async function loadApp(routeAppId: string): Promise<AppItem | undefined> {
  const fallbackApp = getAppByRouteId(routeAppId);

  if (!routeAppId.startsWith("APP_")) {
    return fallbackApp;
  }

  try {
    const runtimeApp = await getRuntimeApp<AppItem>(routeAppId);
    if (runtimeApp?.id === routeAppId) {
      return {
        ...runtimeApp,
        color: normalizeAppColorTone(runtimeApp.color),
      };
    }
  } catch {
    // Fall back to the route-derived display data when the backend is unavailable.
  }

  return fallbackApp;
}
