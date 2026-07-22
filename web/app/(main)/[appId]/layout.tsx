import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, LogoIcon } from "../../components/app-icons";
import {
  appStatusLabel,
  appStatusTone,
  getAppByRouteId,
  getFormsByRouteAppId,
  normalizeAppColorTone,
  type AppItem,
} from "../../lib/apps";
import { AppMainContent, AppShell } from "./components/app-shell";
import { AppHeaderTitle } from "./components/app-header-title";
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
  const app = await loadApp(routeAppId);

  if (!app) {
    notFound();
  }

  const forms = getFormsByRouteAppId(routeAppId);

  return (
    <div className="theme-page-shell min-h-0 flex-1 overflow-hidden">
      <AppShell
        sidebar={
          <FormSidebar initialForms={forms} routeAppId={routeAppId} />
        }
      >
        <header className="app-detail-header theme-card-glass sticky top-0 z-20 shrink-0 overflow-hidden rounded-[20px] p-2">
          <div className="flex flex-wrap items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
              <Link
                href="/myApp"
                aria-label="返回我的应用"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-subtle)]"
              >
                <ArrowLeftIcon />
              </Link>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(145deg,var(--color-secondary),var(--color-primary-active))] text-[var(--color-text-on-primary)] shadow-[var(--shadow-success)]">
                <LogoIcon />
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
                  <AppHeaderTitle appId={routeAppId} initialName={app.name} />
                </div>
                <p className="hidden truncate text-xs text-[var(--color-text-secondary)] sm:block">应用工作台</p>
              </div>
              <span
                className={`hidden shrink-0 rounded-md px-2 py-1 text-xs font-medium md:inline-flex ${appStatusTone[app.status]}`}
              >
                {appStatusLabel[app.status]}
              </span>
            </div>

            <AppTopNav appId={routeAppId} />
          </div>
        </header>
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

  const backendBaseUrl =
    process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

  try {
    const response = await fetch(`${backendBaseUrl}/api/apps/${routeAppId}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      code: number;
      data: AppItem | null;
    };
    const runtimeApp = payload.data;

    if (response.ok && payload.code === 0 && runtimeApp?.id === routeAppId) {
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
