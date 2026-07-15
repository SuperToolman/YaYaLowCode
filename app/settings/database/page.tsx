"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@heroui/react";
import { Field } from "../_components/field";

type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type DatabaseSettings = {
  host: string;
  port: number;
  database: string;
  username: string;
  passwordConfigured: boolean;
};
type FormState = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

export default function DatabaseSettingsPage() {
  const [form, setForm] = useState<FormState>({
    host: "localhost",
    port: "5432",
    database: "yaya_low_code",
    username: "postgres",
    password: "",
  });
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadSettings() {
    setLoading(true);
    setError("");
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
      }));
      setPasswordConfigured(payload.data.passwordConfigured);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载数据库配置");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSettings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
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
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings/database", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port),
          database: form.database,
          username: form.username,
          password: form.password || undefined,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<DatabaseSettings>;
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "保存失败");
      setPasswordConfigured(true);
      setForm((current) => ({ ...current, password: "" }));
      setMessage("连接已验证，配置已保存。后端正在重启，请稍候…");
      await waitForBackend();
      setMessage("后端已重启，新的数据库连接配置已生效。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="theme-panel h-full min-h-0 overflow-y-auto overscroll-contain rounded-[24px] p-6 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">数据库连接</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">PostgreSQL · 本地持久化配置</p>
        </div>
        <span className="rounded-full bg-[var(--color-success-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-success)]">
          {passwordConfigured ? "密码已配置" : "需要配置密码"}
        </span>
      </div>

      <form className="mt-6 space-y-5" onSubmit={saveSettings}>
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label="主机地址">
            <Input fullWidth value={form.host} onChange={(event) => updateField("host", event.target.value)} required disabled={loading || saving} />
          </Field>
          <Field label="端口">
            <Input fullWidth type="number" min="1" max="65535" value={form.port} onChange={(event) => updateField("port", event.target.value)} required disabled={loading || saving} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="数据库名称">
            <Input fullWidth value={form.database} onChange={(event) => updateField("database", event.target.value)} required disabled={loading || saving} />
          </Field>
          <Field label="用户名">
            <Input fullWidth value={form.username} onChange={(event) => updateField("username", event.target.value)} required disabled={loading || saving} />
          </Field>
        </div>
        <Field label="密码" hint={passwordConfigured ? "留空则保留当前密码；密码不会回显。" : "首次保存必须填写密码。"}>
          <Input fullWidth type="password" autoComplete="new-password" value={form.password} onChange={(event) => updateField("password", event.target.value)} disabled={loading || saving} />
        </Field>

        {error ? <p className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
        {message ? <p className="rounded-xl bg-[var(--color-success-soft)] px-4 py-3 text-sm text-[var(--color-success)]">{message}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
          <p className="text-xs leading-5 text-[var(--color-text-secondary)]">配置文件只保存在后端运行目录，不会发送到浏览器。</p>
          <Button type="submit" isDisabled={loading || saving}>
            {saving ? "正在验证并重启…" : "保存并重启后端"}
          </Button>
        </div>
      </form>
    </section>
  );
}
