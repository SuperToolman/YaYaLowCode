"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Button, Input, ListBox, Select, Switch } from "@heroui/react";
import { Field } from "../_components/field";
import { SettingsContentCard } from "../_components/settings-content-card";
import type { AgentModelProvider, ApiEnvelope } from "../agent-types";

type ProviderForm = Omit<AgentModelProvider, "id" | "apiKeyConfigured"> & { apiKey: string };
const emptyProvider: ProviderForm = { name: "OpenAI Compatible", kind: "openai-compatible", enabled: true, apiBaseUrl: "https://api.openai.com/v1", apiKey: "" };
const providerKinds = [
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "local", label: "本地模型" },
];

export default function ModelProvidersPage() {
  const [items, setItems] = useState<AgentModelProvider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyProvider);
  const [message, setMessage] = useState("");

  async function load(preferredId = selectedId) {
    const response = await fetch("/api/agent/providers", { cache: "no-store" });
    const payload = (await response.json()) as ApiEnvelope<AgentModelProvider[]>;
    if (!response.ok || !payload.data) throw new Error(payload.message);
    setItems(payload.data);
    const current = payload.data.find((item) => item.id === preferredId) ?? payload.data[0];
    if (current) select(current);
  }
  useEffect(() => { void load().catch((error) => setMessage(String(error))); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  function select(item: AgentModelProvider) {
    setSelectedId(item.id);
    setForm({ name: item.name, kind: item.kind, enabled: item.enabled, apiBaseUrl: item.apiBaseUrl, apiKey: "" });
  }
  function create() { setSelectedId(null); setMessage(""); setForm(emptyProvider); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const url = selectedId ? `/api/agent/providers/${encodeURIComponent(selectedId)}` : "/api/agent/providers";
    const response = await fetch(url, { method: selectedId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, apiKey: form.apiKey || undefined }) });
    const payload = (await response.json()) as ApiEnvelope<AgentModelProvider>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setMessage("模型提供商已保存");
    setSelectedId(payload.data.id);
    await load(payload.data.id);
  }

  return (
    <SettingsContentCard
      title="模型提供商"
      subtitle={`管理 Agent 使用的模型服务连接。当前共 ${items.length} 个提供商，平台不会自动创建默认数据。`}
      bodyScrollable={false}
      headerActions={<Button onPress={create}>新增提供商</Button>}
      footer={<><p className="text-xs text-[var(--color-text-secondary)]">{selectedId ? "正在编辑已有提供商" : "正在创建新提供商"}</p><Button type="submit" form="model-provider-form">保存配置</Button></>}
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[160px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--color-border)] lg:grid-cols-[210px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="flex min-h-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-2 lg:border-b-0 lg:border-r">
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <Button
              key={item.id}
              fullWidth
              variant="ghost"
              onPress={() => select(item)}
              className={`h-auto min-h-0 justify-start rounded-xl px-3 py-2.5 text-left ${selectedId === item.id ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-secondary)]">
                  {item.enabled ? "已启用" : "已停用"} · {item.kind}
                </span>
              </span>
            </Button>
          ))}
        </nav>
      </aside>

      <form id="model-provider-form" onSubmit={save} className="flex min-h-0 flex-col overflow-hidden bg-[var(--color-bg-surface)]">
        <header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0 max-w-xl">
              <Input
                aria-label="模型提供商名称"
                fullWidth
                className="max-w-md text-lg font-semibold"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
              />
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {selectedId ? "编辑模型提供商" : "正在创建新模型提供商"}
              </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="max-w-4xl rounded-lg border border-[var(--color-border)] p-5">
            <h3 className="text-sm font-semibold">连接配置</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
              统一管理 API 网关和密钥，多个配置文件可复用同一提供商。
            </p>
            <div className="mt-4 space-y-4">
              <Field label="提供商类型">
                <Select aria-label="提供商类型" fullWidth selectedKey={form.kind} onSelectionChange={(key: Key | null) => key !== null && setForm({ ...form, kind: String(key) })}>
                  <Select.Trigger><Select.Value>{providerKinds.find((item) => item.value === form.kind)?.label ?? "请选择"}</Select.Value><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>{providerKinds.map((item) => <ListBox.Item key={item.value} id={item.value} textValue={item.label}>{item.label}</ListBox.Item>)}</ListBox></Select.Popover>
                </Select>
              </Field>
              <Field label="API Base URL">
                <Input fullWidth value={form.apiBaseUrl} onChange={(event) => setForm({ ...form, apiBaseUrl: event.currentTarget.value })} />
              </Field>
              <Field label="API Key" hint={selectedId ? "留空保留已配置密钥。" : "创建启用的提供商时请填写密钥。"}>
                <Input fullWidth type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} />
              </Field>
              <Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}>
                <Switch.Content>启用提供商</Switch.Content>
                <Switch.Control><Switch.Thumb /></Switch.Control>
              </Switch>
            </div>
          </section>
          {message ? <p className="mt-4 rounded-lg bg-[var(--color-bg-subtle)] p-3 text-sm">{message}</p> : null}
        </div>
      </form>
      </div>
    </SettingsContentCard>
  );
}
