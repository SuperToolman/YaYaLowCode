"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import HomeSideBar from "./HomeSideBar";
import { LicenseManagementModal, OPEN_LICENSE_MANAGEMENT_MODAL_EVENT, OPEN_LICENSE_UPDATE_PROMPT_EVENT } from "../../features/settings/components/LicenseManagementModal";
import { getLicenseStatus } from "@/features/settings/api";

export function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  return <AuthBoundary>{children}</AuthBoundary>;
}

function AuthBoundary({ children }: { children: React.ReactNode }) {
  const [licenseReady, setLicenseReady] = useState(false);
  const [licenseValid, setLicenseValid] = useState<boolean | null>(null);
  const [licenseError, setLicenseError] = useState("");
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [licenseUpdatePrompt, setLicenseUpdatePrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshLicense = () => {
      setLicenseReady(false);
      setLicenseError("");
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
        .catch((error: unknown) => {
          if (!cancelled) {
            setLicenseValid(null);
            setLicenseError(error instanceof Error ? error.message : "许可证状态暂时无法读取，请稍后重试。");
          }
        })
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
        <div className="app-main-glass" style={{ visibility: licenseReady && !licenseError ? "visible" : "hidden" }}>{children}</div>
      </div>
      {!licenseReady ? <LicenseCheckingOverlay /> : null}
      {licenseReady && licenseError ? (
        <div className="license-checking-overlay" role="alert">
          <div className="max-w-md space-y-4 p-6 text-center">
            <p className="font-semibold">无法读取许可证状态</p>
            <p className="text-sm">{licenseError}</p>
            <p className="text-sm">如果使用平台运维身份，请从运营平台重新进入实例。</p>
            <Button onPress={() => window.dispatchEvent(new Event("yaya-license-updated"))}>重试</Button>
          </div>
        </div>
      ) : null}
    </div><LicenseManagementModal open={licenseReady && !licenseError && (licenseModalOpen || licenseValid === false)} blocked={licenseReady && licenseValid === false} updateOnly={licenseUpdatePrompt} onOpenChange={setLicenseModalOpen} /></>
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
