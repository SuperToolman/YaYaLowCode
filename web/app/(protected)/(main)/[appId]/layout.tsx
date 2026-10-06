import { notFound } from "next/navigation";
import {
  getAppByRouteId,
  normalizeAppColorTone,
  type AppItem,
} from "@lib/apps";
import { AppMainContent, AppShell } from "./components/AppShell";
import { FormSidebar } from "./components/FormSidebar";
import { getRuntimeApp } from "@features/application/server-api";
import { AppLayoutHeader } from "./components/AppLayoutHeader";

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
        <AppLayoutHeader appId={routeAppId} initialName={app.name} />
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
