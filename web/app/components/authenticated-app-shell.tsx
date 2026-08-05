"use client";

import { useEffect, useState } from "react";
import HomeSideBar from "./HomeSideBar";
import { LicenseManagementModal, OPEN_LICENSE_MANAGEMENT_MODAL_EVENT } from "./license-management-modal";

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  return <AuthBoundary>{children}</AuthBoundary>;
}

function AuthBoundary({ children }: { children: React.ReactNode }) {
  const [licenseReady, setLicenseReady] = useState(false);
  const [licenseValid, setLicenseValid] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);

  useEffect(() => {
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
  }, []);

  return (
    <><div className="app-root-shell" aria-busy={!licenseReady}>
      <HomeSideBar />
      <div className="app-main-region">
        <div className="app-main-glass">{children}</div>
      </div>
      {!licenseReady ? <LicenseCheckingOverlay /> : null}
    </div><LicenseManagementModal open={licenseReady && (licenseModalOpen || !licenseValid)} blocked={licenseReady && !licenseValid} onOpenChange={setLicenseModalOpen} /></>
  );
}

function LicenseCheckingOverlay() {
  return (
    <div className="license-checking-overlay" role="status" aria-live="polite">
      <div className="h-5 w-40 animate-pulse rounded bg-[var(--color-bg-subtle)]" />
      <span className="sr-only">正在检查平台许可证</span>
    </div>
  );
}
