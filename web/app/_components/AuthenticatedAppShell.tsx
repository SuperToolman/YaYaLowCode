"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import HomeSideBar from "./HomeSideBar";
import { LicenseManagementModal, OPEN_LICENSE_MANAGEMENT_MODAL_EVENT, OPEN_LICENSE_UPDATE_PROMPT_EVENT } from "../../features/settings/components/LicenseManagementModal";
import { getLicenseStatus } from "@/features/settings/api";

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  return <AuthBoundary>{children}</AuthBoundary>;
}

function AuthBoundary({ children }: { children: React.ReactNode }) {
  const [licenseReady, setLicenseReady] = useState(false);
  const [licenseValid, setLicenseValid] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [licenseUpdatePrompt, setLicenseUpdatePrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshLicense = () => {
      void getLicenseStatus()
        .then((payload) => {
            if (!cancelled) {
              setLicenseValid(payload.valid === true);
              if (payload.updateAvailable) {
                setLicenseUpdatePrompt(true);
                setLicenseModalOpen(true);
              }
            }
        })
        .catch(() => { if (!cancelled) setLicenseValid(false); })
        .finally(() => { if (!cancelled) setLicenseReady(true); });
    };
    refreshLicense();
    const openLicenseModal = () => {
      setLicenseUpdatePrompt(false);
      setLicenseModalOpen(true);
    };
    const openLicenseUpdatePrompt = () => {
      setLicenseUpdatePrompt(true);
      setLicenseModalOpen(true);
    };
    window.addEventListener("yaya-license-updated", refreshLicense);
    window.addEventListener(OPEN_LICENSE_MANAGEMENT_MODAL_EVENT, openLicenseModal);
    window.addEventListener(OPEN_LICENSE_UPDATE_PROMPT_EVENT, openLicenseUpdatePrompt);
    return () => {
      cancelled = true;
      window.removeEventListener("yaya-license-updated", refreshLicense);
      window.removeEventListener(OPEN_LICENSE_MANAGEMENT_MODAL_EVENT, openLicenseModal);
      window.removeEventListener(OPEN_LICENSE_UPDATE_PROMPT_EVENT, openLicenseUpdatePrompt);
    };
  }, []);

  return (
    <><div className="app-root-shell" aria-busy={!licenseReady}>
      <HomeSideBar />
      <div className="app-main-region">
        <div className="app-main-glass" style={{ visibility: licenseReady ? "visible" : "hidden" }}>{children}</div>
      </div>
      {!licenseReady ? <LicenseCheckingOverlay /> : null}
    </div><LicenseManagementModal open={licenseReady && (licenseModalOpen || !licenseValid)} blocked={licenseReady && !licenseValid} updateOnly={licenseUpdatePrompt} onOpenChange={setLicenseModalOpen} /></>
  );
}

function LicenseCheckingOverlay() {
  return (
    <div className="license-checking-overlay" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <Spinner size="lg" aria-hidden="true" />
        <span className="text-sm text-[var(--color-text-secondary)]">正在加载，请稍候…</span>
      </div>
    </div>
  );
}
