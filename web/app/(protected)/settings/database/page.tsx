"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Switch, toast } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { Field } from "../components/Field";
import { SettingsContentCard } from "../components/SettingsContentCard";
import type { ApiEnvelope } from "@/app/lib/api-request";

type DatabaseSettings = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  cacheTtlHours: number;
  connectionStatus: "connected" | "disconnected";
  connectionError: string | null;
  managedByEnvironment: boolean;
};
type FormState = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  cacheTtlHours: string;
};
type ValkeySettings = {
  enabled: boolean;
  host: string;
  port: number;
  database: number;
  username: string;
  password: string;
  cacheTtlHours: number;
  connectionStatus: "connected" | "disconnected" | "disabled";
  connectionError: string | null;
};
type ValkeyFormState = {
  enabled: boolean;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  cacheTtlHours: string;
};

export default function DatabaseSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    host: "localhost",
    port: "5432",
    database: "yaya_low_code",
    username: "postgres",
    password: "",
    cacheTtlHours: "8",
  });
  const [connectionStatus, setConnectionStatus] = useState<DatabaseSettings["connectionStatus"] | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [managedByEnvironment, setManagedByEnvironment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [valkeyForm, setValkeyForm] = useState<ValkeyFormState>({
    enabled: true,
    host: "127.0.0.1",
    port: "6379",
    database: "0",
    username: "",
    password: "",
    cacheTtlHours: "8",
  });
  const [valkeyStatus, setValkeyStatus] = useState<ValkeySettings["connectionStatus"] | null>(null);
  const [valkeyError, setValkeyError] = useState<string | null>(null);
  const [savingValkey, setSavingValkey] = useState(false);
  const [testingValkey, setTestingValkey] = useState(false);

  async function loadSettings() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/database", { cache: "no-store" });
      const payload = (await response.json()) as ApiEnvelope<DatabaseSettings>;
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "无法加载数据库配置");
      }
      setForm((current) => ({
        ...current,
        host: payload.data!.host,
        port: String(payload.data!.port),
        database: payload.data!.database,
        username: payload.data!.username,
        password: payload.data!.password ?? "",
      }));
      const status = payload.data.connectionStatus === "connected" ? "connected" : "disconnected";
      setConnectionStatus(status);
      setManagedByEnvironment(payload.data.managedByEnvironment);
      setConnectionError(
        payload.data.connectionError ??
          (status === "disconnected" ? "当前后端未返回连接状态，请重启后端后重试。" : null),
      );
      const valkeyResponse = await fetch("/api/settings/valkey", { cache: "no-store" });
      const valkeyPayload = (await valkeyResponse.json()) as ApiEnvelope<ValkeySettings>;
      if (!valkeyResponse.ok || valkeyPayload.code !== 0 || !valkeyPayload.data) {
        throw new Error(valkeyPayload.message || "无法加载 Valkey 配置");
      }
      setValkeyForm({
        enabled: valkeyPayload.data.enabled,
        host: valkeyPayload.data.host,
        port: String(valkeyPayload.data.port),
        database: String(valkeyPayload.data.database),
        username: valkeyPayload.data.username,
        password: valkeyPayload.data.password ?? "",
        cacheTtlHours: String(valkeyPayload.data.cacheTtlHours),
      });
      setValkeyStatus(valkeyPayload.data.connectionStatus);
      setValkeyError(valkeyPayload.data.connectionError);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "无法加载数据库配置";
      setConnectionStatus("disconnected");
      setConnectionError(message);
      toast.danger("无法加载数据库配置", { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/settings/license", { cache: "no-store" }).then((response) => response.json()).then((payload) => {
        if (payload.data?.deploymentType !== "local") {
          router.replace("/settings/about");
          return;
        }
        void loadSettings();
      }).catch(() => router.replace("/settings/about"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateValkeyField(field: keyof ValkeyFormState, value: string | boolean) {
    setValkeyForm((current) => ({ ...current, [field]: value }));
  }

  async function waitForBackend() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        const response = await fetch("/api/settings/database", { cache: "no-store" });
        if (response.ok) return;
      } catch {
        // The replacement backend has not bound its port yet.
      }
    }
    throw new Error("后端重启超时，请检查后端进程日志");
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/settings/database", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port),
          database: form.database,
          username: form.username,
          password: form.password,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<DatabaseSettings>;
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "保存失败");
      setConnectionStatus(payload.data?.connectionStatus ?? "connected");
      setConnectionError(payload.data?.connectionError ?? null);
      await waitForBackend();
      toast.success("数据库配置已保存", { description: "后端已重启，新的连接配置已生效。" });
    } catch (reason) {
      toast.danger("保存失败", { description: reason instanceof Error ? reason.message : "请稍后重试。" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const response = await fetch("/api/settings/database/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port),
          database: form.database,
          username: form.username,
          password: form.password,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<null>;
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "连接测试失败");
      toast.success("连接测试成功", { description: "当前输入的配置尚未保存。" });
    } catch (reason) {
      toast.danger("连接测试失败", { description: reason instanceof Error ? reason.message : "请稍后重试。" });
    } finally {
      setTesting(false);
    }
  }

  async function saveValkeySettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingValkey(true);
    try {
      const response = await fetch("/api/settings/valkey", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: valkeyForm.enabled,
          host: valkeyForm.host,
          port: Number(valkeyForm.port),
          database: Number(valkeyForm.database),
          username: valkeyForm.username,
          password: valkeyForm.password,
          cacheTtlHours: Number(valkeyForm.cacheTtlHours),
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<ValkeySettings>;
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "保存失败");
      setValkeyStatus(payload.data?.connectionStatus ?? (valkeyForm.enabled ? "connected" : "disabled"));
      setValkeyError(payload.data?.connectionError ?? null);
      await waitForBackend();
      toast.success("Valkey 配置已保存", { description: "后端已重启，缓存连接已生效。" });
    } catch (reason) {
      toast.danger("保存失败", { description: reason instanceof Error ? reason.message : "请稍后重试。" });
    } finally {
      setSavingValkey(false);
    }
  }

  async function testValkeyConnection() {
    setTestingValkey(true);
    try {
      const response = await fetch("/api/settings/valkey/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: valkeyForm.enabled,
          host: valkeyForm.host,
          port: Number(valkeyForm.port),
          database: Number(valkeyForm.database),
          username: valkeyForm.username,
          password: valkeyForm.password,
          cacheTtlHours: Number(valkeyForm.cacheTtlHours),
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<null>;
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "连接测试失败");
      toast.success("Valkey 连接测试成功", { description: "当前输入的配置尚未保存。" });
    } catch (reason) {
      toast.danger("连接测试失败", { description: reason instanceof Error ? reason.message : "请稍后重试。" });
    } finally {
      setTestingValkey(false);
    }
  }

  return (
    <section className="h-full min-h-0">
      <SettingsContentCard title="数据库连接" subtitle="管理平台的数据存储服务与连接状态">
        <div className="space-y-4">
          <Card className="border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">PostgreSQL</h3>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{managedByEnvironment ? "由部署环境管理" : "本地持久化配置"}</p>
              </div>
              <div className="flex items-center gap-2">
            <span
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                connectionStatus === "connected"
                  ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                  : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
              ].join(" ")}
            >
              {loading ? "正在检测" : connectionStatus === "connected" ? "连接正常" : "连接失败"}
            </span>
              </div>
            </div>

        <form className="mt-6 space-y-5" onSubmit={saveSettings}>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="主机地址">
              <Input fullWidth value={form.host} onChange={(event) => updateField("host", event.target.value)} required disabled={loading || saving || testing || managedByEnvironment} />
            </Field>
            <Field label="端口">
              <Input fullWidth type="number" min="1" max="65535" value={form.port} onChange={(event) => updateField("port", event.target.value)} required disabled={loading || saving || testing || managedByEnvironment} />
            </Field>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Field label="数据库名称">
              <Input fullWidth value={form.database} onChange={(event) => updateField("database", event.target.value)} required disabled={loading || saving || testing || managedByEnvironment} />
            </Field>
            <Field label="用户名">
              <Input fullWidth value={form.username} onChange={(event) => updateField("username", event.target.value)} required disabled={loading || saving || testing || managedByEnvironment} />
            </Field>
            <Field label="密码" hint={managedByEnvironment ? "密码由部署环境保存，不会在平台中展示。" : "可留空以连接无密码实例。"}>
              <Input fullWidth type="password" autoComplete="off" value={form.password} onChange={(event) => updateField("password", event.target.value)} disabled={loading || saving || testing || managedByEnvironment} />
            </Field>
          </div>

          {connectionError ? <p className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">连接详情：{connectionError}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
            <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{managedByEnvironment ? "数据库连接由部署环境的 DATABASE_URL 管理；请在部署配置中修改。" : "页面显示后端当前完整配置，保存前会验证数据库连接。"}</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" isDisabled={loading || saving || testing || managedByEnvironment} onPress={() => void testConnection()}>
                {testing ? "正在测试…" : "连接测试"}
              </Button>
              <Button type="submit" isDisabled={loading || saving || testing || managedByEnvironment}>
                {saving ? "正在验证并重启…" : "保存并重启后端"}
              </Button>
            </div>
          </div>
        </form>
          </Card>

          <Card className="border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Valkey</h3>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">缓存与队列服务配置</p>
              </div>
              <span className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                valkeyStatus === "connected"
                  ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                  : valkeyStatus === "disabled"
                    ? "bg-[var(--color-control-soft)] text-[var(--color-text-secondary)]"
                    : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
              ].join(" ")}>{loading ? "正在检测" : valkeyStatus === "connected" ? "连接正常" : valkeyStatus === "disabled" ? "已关闭" : "连接失败"}</span>
            </div>
        <form className="mt-6 space-y-5" onSubmit={saveValkeySettings}>
          <Switch isSelected={valkeyForm.enabled} onChange={(value) => updateValkeyField("enabled", value)} isDisabled={loading || savingValkey || testingValkey}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用 Valkey 缓存</Switch.Content></Switch>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)]">
            <Field label="主机地址"><Input fullWidth value={valkeyForm.host} onChange={(event) => updateValkeyField("host", event.target.value)} required disabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} /></Field>
            <Field label="端口"><Input fullWidth type="number" min="1" max="65535" value={valkeyForm.port} onChange={(event) => updateValkeyField("port", event.target.value)} required disabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} /></Field>
            <Field label="数据库编号"><Input fullWidth type="number" min="0" max="15" value={valkeyForm.database} onChange={(event) => updateValkeyField("database", event.target.value)} required disabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} /></Field>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Field label="用户名（可选）"><Input fullWidth placeholder="default" value={valkeyForm.username} onChange={(event) => updateValkeyField("username", event.target.value)} disabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} /></Field>
            <Field label="密码（可选）"><Input fullWidth type="password" autoComplete="new-password" value={valkeyForm.password} onChange={(event) => updateValkeyField("password", event.target.value)} disabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} /></Field>
          </div>
          <Field label="缓存 TTL（小时）"><Input fullWidth type="number" min="1" max="24" value={valkeyForm.cacheTtlHours} onChange={(event) => updateValkeyField("cacheTtlHours", event.target.value)} required disabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} /></Field>
          {valkeyError ? <p className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">连接详情：{valkeyError}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
            <p className="text-xs leading-5 text-[var(--color-text-secondary)]">Valkey 仅用于缓存与实时能力，PostgreSQL 仍是业务数据主库。</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" isDisabled={loading || savingValkey || testingValkey || !valkeyForm.enabled} onPress={() => void testValkeyConnection()}>{testingValkey ? "正在测试…" : "连接测试"}</Button>
              <Button type="submit" isDisabled={loading || savingValkey || testingValkey}>{savingValkey ? "正在验证并重启…" : "保存并重启后端"}</Button>
            </div>
          </div>
        </form>
          </Card>
        </div>
      </SettingsContentCard>
    </section>
  );
}
