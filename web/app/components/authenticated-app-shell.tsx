"use client";

import { usePathname } from "next/navigation";
import HomeSideBar from "./HomeSideBar";
import { AuthProvider } from "./auth-provider";

const PUBLIC_PATHS = new Set(["/login"]);

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthBoundary>{children}</AuthBoundary>
    </AuthProvider>
  );
}

function AuthBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  if (isPublicPath) return <>{children}</>;

  return (
    <div className="app-root-shell">
      <HomeSideBar />
      <div className="app-main-region">
        <div className="app-main-glass">{children}</div>
      </div>
    </div>
  );
}
