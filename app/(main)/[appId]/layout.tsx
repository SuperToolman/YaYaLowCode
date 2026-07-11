import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { ArrowLeftIcon, GearIcon, LogoIcon } from "../../components/app-icons";
import {
  appStatusLabel,
  appStatusTone,
  getAppByRouteId,
  getFormsByRouteAppId,
} from "../../lib/apps";
import { AppShell } from "./components/app-shell";
import { AppTopNav } from "./components/app-top-nav";
import { FormSidebar } from "./components/form-sidebar";

export default async function AppLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ appId: string }>;
}>) {
  const { appId: routeAppId } = await params;
  const app = getAppByRouteId(routeAppId);

  if (!app) {
    notFound();
  }

  const forms = getFormsByRouteAppId(routeAppId);

  return (
    <div className="theme-page-shell">
      <AppShell
        sidebar={
          <FormSidebar initialForms={forms} routeAppId={routeAppId} />
        }
      >
        <Card className="app-detail-header sticky top-0 z-20 shrink-0 overflow-hidden border border-[var(--panel-border)] bg-[var(--panel-background-strong)] shadow-[0_8px_24px_rgba(20,33,61,0.04)] backdrop-blur-xl">
          <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4 lg:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
              <Link
                href="/myApp"
                aria-label="返回我的应用"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)]"
              >
                <ArrowLeftIcon />
              </Link>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,#49c76d,#19a84d)] text-white shadow-[0_8px_18px_rgba(25,168,77,0.2)]">
                <LogoIcon />
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-[var(--text-primary)] sm:text-lg">
                  {app.name}
                </div>
                <p className="hidden truncate text-xs text-[var(--text-muted)] sm:block">应用工作台</p>
              </div>
              <span
                className={`hidden shrink-0 rounded-md px-2 py-1 text-xs font-medium md:inline-flex ${appStatusTone[app.status]}`}
              >
                {appStatusLabel[app.status]}
              </span>
            </div>

            <AppTopNav appId={routeAppId} />

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button
                type="button"
                aria-label="应用设置"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)]"
              >
                <GearIcon />
              </Button>
              <Button variant="ghost" size="sm" className="h-9 rounded-lg bg-[var(--accent-strong)] px-3 text-white hover:brightness-95">
                访问
              </Button>
            </div>
          </div>
        </Card>
        <main>{children}</main>
      </AppShell>
    </div>
  );
}
