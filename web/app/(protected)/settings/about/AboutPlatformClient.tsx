"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MarkdownPreview from "@uiw/react-markdown-preview";
import { useTheme } from "@global-components/ThemeProvider";
import { Button, Chip, Surface } from "@heroui/react";
import { useAuth } from "@components/AuthProvider";
import { openLicenseManagementModal } from "@components/LicenseManagementModal";
import { SettingsContentCard } from "../components/SettingsContentCard";
import { getLicenseStatus, getValkeyRuntimeStatus, type ValkeyRuntimeStatus } from "@features/settings/api";

type LicenseStatus = import("@lib/http").PlatformLicenseStatus;

export default function AboutPlatformClient({ changelog }: {
  changelog: { markdown: string; version: string | null } | null;
}) {
  const { hasPermission } = useAuth();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [refreshingChangelog, startChangelogRefresh] = useTransition();
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getLicenseStatus()
        .then((status) => {
          if (!cancelled) setLicense(status);
        })
        .catch(() => {
          if (!cancelled) setLicense(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <section className="h-full min-h-0">
      <SettingsContentCard
        title="关于平台"
        subtitle="版本、授权与服务状态"
        bodyClassName="flex flex-col overflow-y-auto lg:overflow-hidden"
      >
        <div className="flex min-h-0 flex-col gap-3 lg:flex-1">
          <Surface
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-lg font-bold text-accent-foreground">丫</div>
              <div>
                <p className="m-0 text-sm font-semibold">丫丫 LowCode</p>
                <p className="mt-1 text-xs text-muted">
                  {changelog?.version ? `版本 ${changelog.version}` : "版本未知"}
                  {license ? ` · ${license.deploymentType === "local" ? "本地部署" : "SaaS"} · ${license.modules.length} 个授权模块` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip color={license?.valid ? "success" : "danger"}>
                {loading
                  ? "正在检查"
                  : license?.valid
                    ? "许可证有效"
                    : "许可证无效"}
              </Chip>
              {hasPermission("settings.license.manage") ? (
                <Button size="sm" onPress={openLicenseManagementModal}>更新签名</Button>
              ) : null}
            </div>
          </Surface>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto" aria-label="平台与服务信息">
              <Surface className="shrink-0 p-4">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-sm font-semibold">平台授权</h3>
                </div>
                <dl className="mt-3.5 grid gap-2.5 text-sm">
                  <Info label="授权主体" value={license?.subject ?? "-"} />
                  <Info
                    label="许可证编号"
                    value={license?.licenseId ?? "-"}
                    mono
                  />
                  <Info label="有效期至" value={formatExpiry(license?.expiresAt)} />
                  <Info
                    label="状态说明"
                    value={
                      license?.valid
                        ? "签名与在线状态验证通过"
                        : (license?.reason ?? "无法读取许可证状态")
                    }
                  />
                  <Info
                    label="授权中心 API"
                    value={license?.licenseCenterUrl ?? "-"}
                    mono
                  />
                </dl>
              </Surface>

              <ValkeyStatusCard />

              <Surface className="shrink-0 p-4">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-sm font-semibold">已授权模块</h3>
                  <Chip>{license?.modules.length ?? 0} 项</Chip>
                </div>
                <div className="mt-2.5 divide-y divide-separator">
                  {license?.modules.length ? (
                    license.modules.map((module) => (
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" key={module}>
                        <div>
                          <span className="text-sm font-medium">
                            {license.moduleTitles?.[module] ??
                              defaultModuleTitle(module)}
                          </span>
                          <span className="ms-1.5 font-mono text-xs text-muted">{module}</span>
                        </div>
                        <span className="text-xs text-muted">
                          有效期至{" "}
                          {formatExpiry(
                            license.moduleExpiresAt?.[module] ?? license.expiresAt,
                          )}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="m-0 py-3 text-sm text-muted">暂未授予任何模块</div>
                  )}
                </div>
              </Surface>
            </aside>

            <Surface className="flex min-h-0 min-w-0 flex-col p-4">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="m-0 text-sm font-semibold">更新日志</h3>
                  <p className="mt-1 text-xs text-muted">项目版本与变更记录</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {changelog?.version ? <Chip>{changelog.version}</Chip> : null}
                  <Button size="sm" isDisabled={refreshingChangelog} onPress={() => {
                    startChangelogRefresh(() => router.refresh());
                  }}>{refreshingChangelog ? "正在刷新" : "刷新日志"}</Button>
                </div>
              </div>
              {changelog?.markdown ? (
                <div className="mt-3.5 max-h-[36rem] overflow-auto pe-2 lg:max-h-none lg:min-h-0 lg:flex-1" data-color-mode={resolvedTheme} tabIndex={0} role="region" aria-label="更新日志内容">
                  <MarkdownPreview source={changelog.markdown} style={{ backgroundColor: "transparent" }} />
                </div>
              ) : (
                <p className="m-0 py-3 text-sm text-muted">暂时无法读取更新日志</p>
              )}
            </Surface>
          </div>
        </div>
      </SettingsContentCard>
    </section>
  );
}

function ValkeyStatusCard() {
  const [status, setStatus] = useState<ValkeyRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getValkeyRuntimeStatus(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setStatus(result);
          setCheckedAt(new Date());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取运行状态，请稍后重试");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const connected = !error && status?.status === "connected";
  const statusText = loading ? "正在检查" : error ? "检查失败" : connected
    ? "运行正常" : status?.status === "disabled" ? "未启用" : "连接异常";

  return (
    <Surface className="shrink-0 p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="m-0 text-sm font-semibold">Valkey 缓存</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={loading ? "default" : connected ? "success" : error || status?.status === "disconnected" ? "danger" : "default"}>
            {statusText}
          </Chip>
          <Button size="sm" isDisabled={loading} onPress={() => {
            setLoading(true);
            setError(null);
            setRevision((value) => value + 1);
          }}>刷新</Button>
        </div>
      </div>
      <dl className="mt-3.5 grid gap-2.5 text-sm" aria-live="polite">
        <Info label="状态说明" value={loading ? "正在检查缓存连接" : error ?? status?.message ?? "-"} />
        <Info
          label="PING 耗时"
          value={!loading && connected && status?.latencyMs != null
            ? `${status.latencyMs.toFixed(3)} ms`
            : "-"}
        />
        <Info label="检查时间" value={checkedAt?.toLocaleTimeString("zh-CN") ?? "-"} />
      </dl>
    </Surface>
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

function Info({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`m-0 wrap-anywhere ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
