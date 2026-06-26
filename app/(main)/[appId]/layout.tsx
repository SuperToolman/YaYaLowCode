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
    <div className="min-h-screen bg-[#f5f8fc]">
      <AppShell
        sidebar={
          <FormSidebar initialForms={forms} routeAppId={routeAppId} />
        }
      >
        <Card className="header border-b border-[var(--nav-line)] bg-white">
          <div className="mx-auto flex items-center justify-between gap-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href="/"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)]"
              >
                <ArrowLeftIcon />
              </Link>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#49c76d,#19a84d)] text-white shadow-[0_10px_20px_rgba(25,168,77,0.2)]">
                <LogoIcon />
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-[var(--text-primary)]">
                  {app.name}
                </div>
              </div>
              <span
                className={`hidden rounded-lg px-2.5 py-1 text-xs font-medium sm:inline-flex ${appStatusTone[app.status]}`}
              >
                {appStatusLabel[app.status]}
              </span>
            </div>

            <nav className="hidden items-center gap-10 text-sm text-[var(--text-secondary)] lg:flex">
              <a
                className="border-b-[3px] border-[var(--brand-blue)] pb-4 text-[var(--text-primary)]"
                href="#"
              >
                页面管理
              </a>
              <a href="#">集成&amp;自动化</a>
              <a href="#">应用设置</a>
              <a href="#">应用发布</a>
            </nav>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                aria-label="应用设置"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)]"
              >
                <GearIcon />
              </Button>
              <Button variant="ghost" size="sm">
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
