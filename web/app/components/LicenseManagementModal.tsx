"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, TextArea, toast } from "@heroui/react";
import { useAuth } from "./AuthProvider";

export const OPEN_LICENSE_MANAGEMENT_MODAL_EVENT = "yaya-open-license-management-modal";
export const OPEN_LICENSE_UPDATE_PROMPT_EVENT = "yaya-open-license-update-prompt";

export function openLicenseManagementModal() {
  window.dispatchEvent(new Event(OPEN_LICENSE_MANAGEMENT_MODAL_EVENT));
}

export function openLicenseUpdatePrompt() {
  window.dispatchEvent(new Event(OPEN_LICENSE_UPDATE_PROMPT_EVENT));
}

type LicenseStatus = {
  valid: boolean;
  reason: string | null;
  licenseCenterUrl: string | null;
  licenseId: string | null;
  subject: string | null;
  modules: string[];
  expiresAt: number | null;
  moduleExpiresAt: Record<string, number>;
  platformStatus: "running" | "expired";
  moduleStatuses: Record<string, "running" | "expired">;
  updateAvailable: boolean;
  latestLicenseId: string | null;
  latestIssuedAt: number | null;
};

type Envelope<T> = { code: number; message: string; data: T | null };

export function LicenseManagementModal({ open, blocked, updateOnly = false, onOpenChange }: { open: boolean; blocked: boolean; updateOnly?: boolean; onOpenChange: (open: boolean) => void }) {
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseCenterUrl, setLicenseCenterUrl] = useState("");
  const [license, setLicense] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/license", { cache: "no-store" });
      const payload = await response.json() as Envelope<LicenseStatus>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "无法读取许可证状态");
      setStatus(payload.data);
      setLicenseCenterUrl(payload.data.licenseCenterUrl ?? "");
    } catch (error) {
      toast.danger("无法读取许可证状态", { description: error instanceof Error ? error.message : "请检查 API 服务。" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  async function activate() {
    if (!licenseCenterUrl.trim() || !license.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/license", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licenseCenterUrl: licenseCenterUrl.trim(), license: license.trim() }),
      });
      const payload = await response.json() as Envelope<LicenseStatus>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "更新失败");
      setStatus(payload.data);
      setLicense("");
      toast.success("平台许可证已更新");
      window.dispatchEvent(new Event("yaya-license-updated"));
      onOpenChange(false);
    } catch (error) {
      toast.danger("无法更新许可证", { description: error instanceof Error ? error.message : "请检查许可中心地址和许可证。" });
    } finally {
      setSaving(false);
    }
  }

  async function applyLatest() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/license/latest", { method: "POST" });
      const payload = await response.json() as Envelope<LicenseStatus>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "更新失败");
      setStatus(payload.data);
      toast.success("平台签名已更新", { description: "新购买的模块和 AI 员工权益已经生效。" });
      window.dispatchEvent(new Event("yaya-license-updated"));
      onOpenChange(false);
    } catch (error) {
      toast.danger("无法更新平台签名", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setSaving(false);
    }
  }

  const active = status?.valid === true;
  const canManage = hasPermission("settings.license");
  const canDismiss = !blocked && !saving;
  const isUpdatePrompt = updateOnly || Boolean(status?.updateAvailable);

  return <Modal isOpen={open} onOpenChange={(nextOpen) => { if (!nextOpen && canDismiss) onOpenChange(false); }}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={canDismiss}><Modal.Container placement="center" size="lg"><Modal.Dialog className="max-h-[90vh] rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>{isUpdatePrompt ? "许可证更新提示" : "更新平台签名"}</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={!canDismiss} /></Modal.Header><Modal.Body className="space-y-5 overflow-y-auto"><div className={`rounded-md px-4 py-3 text-sm ${active ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}><p className="font-semibold">{loading ? "正在检查许可证" : active ? "许可证有效" : "许可证无效"}</p>{!loading && !active && status?.reason ? <p className="mt-1 opacity-90">{status.reason}</p> : null}{active && status?.expiresAt ? <p className="mt-1 opacity-90">平台有效至 {new Date(status.expiresAt * 1000).toLocaleString("zh-CN")}</p> : null}</div>{isUpdatePrompt ? <div className="space-y-2 border-y border-[var(--color-border)] py-4"><p className="text-sm font-semibold text-[var(--color-text-primary)]">检测到包含新权益的许可证</p><p className="text-sm text-[var(--color-text-secondary)]">是否更新当前平台许可证？确认后，新购买的模块和 AI 员工会立即生效。</p>{status?.latestLicenseId ? <p className="break-all font-mono text-xs text-[var(--color-text-secondary)]">{status.latestLicenseId}{status.latestIssuedAt ? ` · ${new Date(status.latestIssuedAt * 1000).toLocaleString("zh-CN")}` : ""}</p> : null}</div> : null}{status?.licenseId ? <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-[var(--color-text-secondary)]">许可证编号</dt><dd className="mt-1 break-all font-mono text-[var(--color-text-primary)]">{status.licenseId}</dd></div><div><dt className="text-[var(--color-text-secondary)]">授权主体</dt><dd className="mt-1 text-[var(--color-text-primary)]">{status.subject}</dd></div></dl> : null}{canManage && !isUpdatePrompt ? <div className="space-y-4 border-t border-[var(--color-border)] pt-5"><label className="block text-sm font-medium text-[var(--color-text-primary)]">运营管理平台 API 地址<Input className="mt-2" fullWidth placeholder="https://operation.example.com:8779" value={licenseCenterUrl} onChange={(event) => setLicenseCenterUrl(event.currentTarget.value)} disabled={loading || saving} /></label><label className="block text-sm font-medium text-[var(--color-text-primary)]">许可证<TextArea aria-label="平台许可证" className="mt-2 min-h-32 font-mono text-xs" fullWidth placeholder="粘贴由运营管理平台签发的 RS256 JWT" value={license} onChange={(event) => setLicense(event.currentTarget.value)} disabled={loading || saving} /></label></div> : !canManage ? <p className="text-sm text-[var(--color-text-secondary)]">当前账号没有更新平台签名的权限，请联系平台管理员。</p> : null}</Modal.Body><Modal.Footer>{canDismiss ? <Button variant="ghost" isDisabled={saving} onPress={() => onOpenChange(false)}>取消</Button> : null}{canManage && isUpdatePrompt ? <Button isDisabled={loading || saving} isPending={saving} onPress={() => void applyLatest()}>{saving ? "正在更新" : "确认更新许可证"}</Button> : canManage ? <Button isDisabled={loading || saving || !licenseCenterUrl.trim() || !license.trim()} onPress={() => void activate()}>{saving ? "正在验证并更新" : active ? "更新签名" : "验证并激活"}</Button> : null}</Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
