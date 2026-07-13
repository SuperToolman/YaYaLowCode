"use client";

import { useEffect, useState } from "react";
import { Field, inputClassName } from "../_components/field";

type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type AgentFormState = {
  enabled: boolean;
  provider: "openai-compatible" | "openai" | "deepseek" | "local";
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  temperature: string;
  maxSteps: string;
  systemPrompt: string;
};
type AgentSettingsResponse = {
  enabled: boolean;
  provider: AgentFormState["provider"];
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  maxSteps: number;
  systemPrompt: string;
};

export default function AgentSettingsPage() {
  const [form, setForm] = useState<AgentFormState>({
    enabled: false,
    provider: "openai-compatible",
    apiBaseUrl: "https://api.openai.com/v1",
    apiKey: "",
    chatModel: "gpt-4.1-mini",
    embeddingModel: "text-embedding-3-small",
    temperature: "0.2",
    maxSteps: "8",
    systemPrompt: "你是 YaYa 低代码平台助手。帮助用户设计表单、编排自动化、分析数据，并在执行修改前请求确认。",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/settings/agent", { cache: "no-store" });
        const payload = (await response.json()) as ApiEnvelope<AgentSettingsResponse>;
        if (!response.ok || payload.code !== 0 || !payload.data) {
          throw new Error(payload.message || "无法加载 Agent 配置");
        }
        setForm((current) => ({
          ...current,
          enabled: payload.data!.enabled,
          provider: payload.data!.provider,
          apiBaseUrl: payload.data!.apiBaseUrl,
          apiKey: "",
          chatModel: payload.data!.chatModel,
          embeddingModel: payload.data!.embeddingModel,
          temperature: String(payload.data!.temperature),
          maxSteps: String(payload.data!.maxSteps),
          systemPrompt: payload.data!.systemPrompt,
        }));
        setApiKeyConfigured(payload.data.apiKeyConfigured);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法加载 Agent 配置");
      } finally {
        setLoading(false);
      }
    };
    void loadSettings();
  }, []);

  function updateField<K extends keyof AgentFormState>(field: K, value: AgentFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          apiKey: form.apiKey || undefined,
          temperature: Number(form.temperature),
          maxSteps: Number(form.maxSteps),
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<AgentSettingsResponse>;
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "保存 Agent 配置失败");
      }
      setForm((current) => ({
        ...current,
        enabled: payload.data!.enabled,
        provider: payload.data!.provider,
        apiBaseUrl: payload.data!.apiBaseUrl,
        apiKey: "",
        chatModel: payload.data!.chatModel,
        embeddingModel: payload.data!.embeddingModel,
        temperature: String(payload.data!.temperature),
        maxSteps: String(payload.data!.maxSteps),
        systemPrompt: payload.data!.systemPrompt,
      }));
      setApiKeyConfigured(payload.data.apiKeyConfigured);
      setMessage("Agent 配置已保存到后端本地配置文件，新的会话将使用当前模型配置。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存 Agent 配置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="theme-panel h-full min-h-0 overflow-y-auto overscroll-contain rounded-[24px] p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Agent 模型配置</h2>
            <span className="rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-info)]">MVP</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
            配置 Agent 使用的模型、Embedding 和执行参数。API Key 仅保存在 Rust 后端本地。
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">启用 Agent</span>
          <input type="checkbox" className="peer sr-only" checked={form.enabled} disabled={loading || saving} onChange={(event) => updateField("enabled", event.currentTarget.checked)} />
          <span className="relative h-6 w-11 rounded-full bg-[var(--color-control-selected)] transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-[var(--color-bg-surface)] after:shadow after:transition-transform peer-checked:bg-[var(--color-primary)] peer-checked:after:translate-x-5" />
        </label>
      </div>

      <form className="mt-6 space-y-5" onSubmit={saveSettings}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="模型供应商">
            <select className={inputClassName} value={form.provider} disabled={loading || saving} onChange={(event) => updateField("provider", event.currentTarget.value as AgentFormState["provider"])}>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="local">本地 OpenAI Compatible 模型</option>
            </select>
          </Field>
          <Field label="API Base URL" hint="支持 OpenAI Compatible 接口和自定义模型网关。">
            <input className={inputClassName} type="url" value={form.apiBaseUrl} disabled={loading || saving} onChange={(event) => updateField("apiBaseUrl", event.currentTarget.value)} placeholder="https://api.openai.com/v1" />
          </Field>
        </div>

        <Field label="API Key" hint={apiKeyConfigured ? "密钥已配置；留空会保留当前密钥，后端不会回显。" : "启用 Agent 前必须配置密钥。"}>
          <input className={inputClassName} type="password" autoComplete="new-password" value={form.apiKey} disabled={loading || saving} onChange={(event) => updateField("apiKey", event.currentTarget.value)} placeholder={apiKeyConfigured ? "留空保留当前密钥" : "输入模型供应商 API Key"} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="对话模型">
            <input className={inputClassName} value={form.chatModel} disabled={loading || saving} onChange={(event) => updateField("chatModel", event.currentTarget.value)} placeholder="gpt-4.1-mini" />
          </Field>
          <Field label="Embedding 模型">
            <input className={inputClassName} value={form.embeddingModel} disabled={loading || saving} onChange={(event) => updateField("embeddingModel", event.currentTarget.value)} placeholder="text-embedding-3-small" />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Temperature" hint="建议 Agent 工具调用保持在 0–0.3。">
            <input className={inputClassName} type="number" min="0" max="2" step="0.1" value={form.temperature} disabled={loading || saving} onChange={(event) => updateField("temperature", event.currentTarget.value)} />
          </Field>
          <Field label="最大执行步骤" hint="限制单次运行允许的模型和工具循环次数。">
            <input className={inputClassName} type="number" min="1" max="30" value={form.maxSteps} disabled={loading || saving} onChange={(event) => updateField("maxSteps", event.currentTarget.value)} />
          </Field>
        </div>

        <Field label="系统提示词" hint="Skill 和页面上下文会在后端接入后附加到系统提示词中。">
          <textarea className="mt-2 min-h-32 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-3 text-sm leading-6 text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-4 focus:ring-[var(--color-primary-soft)]" value={form.systemPrompt} disabled={loading || saving} onChange={(event) => updateField("systemPrompt", event.currentTarget.value)} />
        </Field>

        {message ? <p className="rounded-xl bg-[var(--color-info-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-info)]">{message}</p> : null}
        {error ? <p className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-danger)]">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
          <p className="max-w-2xl text-xs leading-5 text-[var(--color-text-secondary)]">浏览器不会直接调用模型供应商；所有模型请求由后端统一处理。</p>
          <button className="h-11 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={loading || saving}>
            {saving ? "正在保存…" : "保存 Agent 配置"}
          </button>
        </div>
      </form>
    </section>
  );
}
