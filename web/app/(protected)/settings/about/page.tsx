"use client";

import { useEffect, useState } from "react";
import { Button, Chip, Surface } from "@heroui/react";
import { useAuth } from "../../../components/auth-provider";
import { openLicenseManagementModal } from "../../../components/license-management-modal";
import { SettingsContentCard } from "../_components/settings-content-card";
import styles from "./about.module.css";

type LicenseStatus = {
  valid: boolean;
  reason: string | null;
  licenseCenterUrl: string | null;
  licenseId: string | null;
  subject: string | null;
  deploymentType: "saas" | "local";
  modules: string[];
  expiresAt: number | null;
  moduleExpiresAt?: Record<string, number>;
  moduleTitles?: Record<string, string>;
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

  return (
    <section className={styles.page}>
      <SettingsContentCard title="关于平台" subtitle="平台版本与当前授权状态。许可证正文和验证公钥不会在页面中展示。">
        <div className={styles.content}>
          <Surface className={`${styles.statusPanel} ${license?.valid ? styles.statusValid : styles.statusInvalid}`}>
            <div className={styles.statusCopy}>
              <div className={styles.brandMark}>丫</div>
              <div><p className={styles.product}>丫丫 LowCode</p><p className={styles.version}>版本 0.82a · 平台授权中心</p></div>
            </div>
            <div className={styles.actions}><Chip color={license?.valid ? "success" : "danger"}>{loading ? "正在检查" : license?.valid ? "许可证有效" : "许可证无效"}</Chip>{hasPermission("settings.license") ? <Button onPress={openLicenseManagementModal}>更新签名</Button> : null}</div>
          </Surface>

          <div className={styles.metrics}>
            <Metric label="授权模块" value={license?.modules.length ?? 0} suffix="项" />
            <Metric label="平台类型" value={license?.deploymentType === "local" ? "本地部署" : "SaaS"} />
            <Metric label="有效期至" value={formatExpiry(license?.expiresAt)} compact />
          </div>

          <div className={styles.columns}>
            <Surface className={styles.infoCard}><div className={styles.cardHeader}><h3>授权信息</h3><Chip>{license?.licenseId ? "已登记" : "未读取"}</Chip></div><dl className={styles.infoList}><Info label="授权主体" value={license?.subject ?? "-"} /><Info label="许可证编号" value={license?.licenseId ?? "-"} mono /><Info label="状态说明" value={license?.valid ? "签名与在线状态验证通过" : license?.reason ?? "无法读取许可证状态"} /></dl></Surface>
            <Surface className={styles.infoCard}><div className={styles.cardHeader}><h3>平台信息</h3><Chip>{license?.licenseCenterUrl ? "已连接" : "未配置"}</Chip></div><dl className={styles.infoList}><Info label="部署方式" value={license?.deploymentType === "local" ? "本地部署" : "SaaS"} /><Info label="运营管理平台 API" value={license?.licenseCenterUrl ?? "-"} mono /><Info label="平台有效期至" value={formatExpiry(license?.expiresAt)} /></dl></Surface>
          </div>

          <Surface className={styles.modulesCard}><div className={styles.cardHeader}><div><h3>已授权模块</h3><p>模块权限与独立有效期</p></div><Chip>{license?.modules.length ?? 0} 项</Chip></div><div className={styles.moduleList}>{license?.modules.length ? license.modules.map((module) => <div className={styles.module} key={module}><div><span className={styles.moduleName}>{license.moduleTitles?.[module] ?? defaultModuleTitle(module)}</span><span className={styles.moduleKey}>{module}</span></div><span className={styles.moduleExpiry}>有效期至 {formatExpiry(license.moduleExpiresAt?.[module] ?? license.expiresAt)}</span></div>) : <div className={styles.empty}>暂未授予任何模块</div>}</div></Surface>
        </div>
      </SettingsContentCard>
    </section>
  );
}

function formatExpiry(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toLocaleString("zh-CN") : "-";
}

function defaultModuleTitle(module: string) {
  if (module === "platform") return "低代码平台";
  if (module === "communication") return "通讯模型";
  return module;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className={styles.label}>{label}</dt><dd className={`${styles.value} ${mono ? styles.mono : ""}`}>{value}</dd></div>;
}

function Metric({ label, value, suffix, compact = false }: { label: string; value: string | number; suffix?: string; compact?: boolean }) {
  return <Surface className={styles.metric}><span className={styles.metricLabel}>{label}</span><strong className={compact ? styles.metricValueCompact : styles.metricValue}>{value}</strong>{suffix ? <span className={styles.metricSuffix}>{suffix}</span> : null}</Surface>;
}

