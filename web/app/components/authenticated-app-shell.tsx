"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import HomeSideBar from "./HomeSideBar";
import { AuthProvider } from "./auth-provider";
import { LicenseManagementModal, OPEN_LICENSE_MANAGEMENT_MODAL_EVENT } from "./license-management-modal";

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
  const [licenseReady, setLicenseReady] = useState(false);
  const [licenseValid, setLicenseValid] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (isPublicPath) {
      return;
    }
    let cancelled = false;
    const refreshLicense = () => {
      void fetch("/api/settings/license", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { code: number; data: { valid?: boolean } | null };
          if (!cancelled) setLicenseValid(response.ok && payload.code === 0 && payload.data?.valid === true);
        })
        .catch(() => { if (!cancelled) setLicenseValid(false); })
        .finally(() => { if (!cancelled) setLicenseReady(true); });
    };
    refreshLicense();
    const openLicenseModal = () => setLicenseModalOpen(true);
    window.addEventListener("yaya-license-updated", refreshLicense);
    window.addEventListener(OPEN_LICENSE_MANAGEMENT_MODAL_EVENT, openLicenseModal);
    return () => {
      cancelled = true;
      window.removeEventListener("yaya-license-updated", refreshLicense);
      window.removeEventListener(OPEN_LICENSE_MANAGEMENT_MODAL_EVENT, openLicenseModal);
    };
  }, [isPublicPath]);

  if (isPublicPath) return <>{children}</>;

  if (!licenseReady) return <div className="grid min-h-screen place-items-center text-sm text-[var(--color-text-secondary)]">正在检查平台许可证…</div>;
  return (
    <><div className="app-root-shell">
      <HomeSideBar />
      <div className="app-main-region">
        <div className="app-main-glass">{children}</div>
      </div>
    </div><LicenseManagementModal open={licenseModalOpen || !licenseValid} blocked={!licenseValid} onOpenChange={setLicenseModalOpen} /></>
  );
}
