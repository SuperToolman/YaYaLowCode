"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { useAuth } from "../../components/auth-provider";
import { openLicenseManagementModal } from "../../components/license-management-modal";
import { SettingsContentCard } from "../_components/settings-content-card";

type LicenseStatus = {
  valid: boolean;
  reason: string | null;
  licenseCenterUrl: string | null;
  licenseId: string | null;
  subject: string | null;
  modules: string[];
  expiresAt: number | null;
};

type Envelope<T> = { code: number; message: string; data: T | null };

export default function AboutPlatformPage() {
  const { hasPermission } = useAuth();
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch("/api/settings/license", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as Envelope<LicenseStatus>;
          if (!cancelled && response.ok && payload.code === 0) setLicense(payload.data);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const statusText = loading ? "正在检查" : license?.valid ? "有效" : "无效";
  const statusClass = license?.valid ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]";

  return (
    <section className="h-full min-h-0">
      <SettingsContentCard title="关于平台" subtitle="平台版本与当前授权状态。许可证正文和验证公钥不会在页面中展示。">
        <div className="max-w-2xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] pb-5">
            <div><p className="text-base font-semibold text-[var(--color-text-primary)]">丫丫 LowCode</p><p className="mt-1 text-sm text-[var(--color-text-secondary)]">版本 0.82a</p></div>
            <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>许可证{statusText}</span>{hasPermission("settings.license") ? <Button size="sm" variant="secondary" onPress={openLicenseManagementModal}>更新签名</Button> : null}</div>
          </div>
          <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
            <Info label="授权主体" value={license?.subject ?? "-"} />
            <Info label="许可证编号" value={license?.licenseId ?? "-"} mono />
            <Info label="有效期至" value={license?.expiresAt ? new Date(license.expiresAt * 1000).toLocaleString("zh-CN") : "-"} />
            <Info label="许可中心" value={license?.licenseCenterUrl ?? "-"} />
            <Info label="已授权模块" value={license?.modules.length ? license.modules.join("、") : "-"} />
            <Info label="状态说明" value={license?.valid ? "签名与在线状态验证通过" : license?.reason ?? "无法读取许可证状态"} />
          </dl>
        </div>
      </SettingsContentCard>
    </section>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className="text-[var(--color-text-secondary)]">{label}</dt><dd className={`mt-1 break-all text-[var(--color-text-primary)] ${mono ? "font-mono text-xs" : ""}`}>{value}</dd></div>;
}
