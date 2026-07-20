"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Button, Input, ListBox, Select, Switch } from "@heroui/react";
import { Field } from "./field";
import type { ApiEnvelope } from "../agent-types";

type Kind = "plugin" | "skill" | "knowledge";
type Resource = { id: string; name: string; description: string; enabled: boolean; version?: string; entrypoint?: string; requiresConfirmation?: boolean; allowedTools?: string[]; retrievalMode?: string; sourceIds?: string[] };

const meta = {
  plugin: { title: "插件", description: "注册 Agent 可加载的扩展插件、入口和确认策略。", endpoint: "/api/agent/plugins" },
  skill: { title: "Skills", description: "定义任务能力、允许调用的工具和人工确认策略。", endpoint: "/api/agent/skills" },
  knowledge: { title: "知识库", description: "管理 Agent 可检索的知识集合与数据源绑定。", endpoint: "/api/agent/knowledge-bases" },
} as const;
const retrievalModeLabels: Record<string, string> = { hybrid: "混合检索", vector: "向量检索", keyword: "关键词检索" };

function empty(kind: Kind): Omit<Resource, "id"> {
  return { name: `新${meta[kind].title}`, description: "", enabled: true, version: kind === "plugin" ? "0.1.0" : undefined, entrypoint: "", requiresConfirmation: kind === "knowledge" ? undefined : false, allowedTools: [], retrievalMode: kind === "knowledge" ? "hybrid" : undefined, sourceIds: [] };
}

export function AgentResourcePage({ kind }: { kind: Kind }) {
  const config = meta[kind];
  const [items, setItems] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Resource, "id">>(() => empty(kind));
  const [message, setMessage] = useState("");

  async function load(preferredId = selectedId) {
    const response = await fetch(config.endpoint, { cache: "no-store" });
    const payload = (await response.json()) as ApiEnvelope<Resource[]>;
    if (!response.ok || !payload.data) throw new Error(payload.message);
    setItems(payload.data);
    const current = payload.data.find((item) => item.id === preferredId) ?? payload.data[0];
    if (current) { const { id, ...next } = current; void id; setSelectedId(current.id); setForm(next); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setMessage(String(error)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function create() { setSelectedId(null); setForm(empty(kind)); }
  function select(item: Resource) { const { id, ...next } = item; setSelectedId(id); setForm(next); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); const url = selectedId ? `${config.endpoint}/${encodeURIComponent(selectedId)}` : config.endpoint;
    const response = await fetch(url, { method: selectedId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const payload = (await response.json()) as ApiEnvelope<Resource>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setMessage(`${config.title}已保存`); setSelectedId(payload.data.id); await load(payload.data.id);
  }
  async function remove() { if (!selectedId) return; const response = await fetch(`${config.endpoint}/${encodeURIComponent(selectedId)}`, { method: "DELETE" }); const payload = (await response.json()) as ApiEnvelope<unknown>; if (!response.ok) return setMessage(payload.message); setSelectedId(null); setForm(empty(kind)); setMessage(`${config.title}已删除`); await load(null); }

  return <section className="theme-panel h-full min-h-0 overflow-y-auto rounded-[22px] p-5 shadow-[var(--shadow-card)]">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{config.title}</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{config.description}</p></div><Button onPress={create}>新增{config.title}</Button></div>
    <div className="mt-5 flex flex-wrap gap-2">{items.map((item) => <Button key={item.id} variant="secondary" onPress={() => select(item)} className={selectedId === item.id ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : ""}>{item.name}</Button>)}</div>
    <form onSubmit={save} className="mt-5 space-y-4 border-t border-[var(--color-border)] pt-5">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></div>
      {kind === "plugin" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="版本"><Input fullWidth value={form.version ?? ""} onChange={(event) => setForm({ ...form, version: event.currentTarget.value })} /></Field><Field label="入口"><Input fullWidth value={form.entrypoint ?? ""} onChange={(event) => setForm({ ...form, entrypoint: event.currentTarget.value })} placeholder="plugin.module:register" /></Field></div> : null}
      {kind === "skill" ? <Field label="允许工具" hint="多个工具名使用英文逗号分隔。"><Input fullWidth value={(form.allowedTools ?? []).join(", ")} onChange={(event) => setForm({ ...form, allowedTools: split(event.currentTarget.value) })} /></Field> : null}
      {kind === "knowledge" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="检索模式"><Select aria-label="检索模式" fullWidth selectedKey={form.retrievalMode ?? "hybrid"} onSelectionChange={(key: Key | null) => key !== null && setForm({ ...form, retrievalMode: String(key) })}><Select.Trigger><Select.Value>{retrievalModeLabels[form.retrievalMode ?? "hybrid"]}</Select.Value><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="hybrid">混合检索</ListBox.Item><ListBox.Item id="vector">向量检索</ListBox.Item><ListBox.Item id="keyword">关键词检索</ListBox.Item></ListBox></Select.Popover></Select></Field><Field label="数据源 IDs"><Input fullWidth value={(form.sourceIds ?? []).join(", ")} onChange={(event) => setForm({ ...form, sourceIds: split(event.currentTarget.value) })} /></Field></div> : null}
      <div className="flex flex-wrap gap-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content>启用</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>{kind !== "knowledge" ? <Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content>执行前需确认</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch> : null}</div>
      {message ? <p className="rounded-lg bg-[var(--color-bg-subtle)] p-3 text-sm">{message}</p> : null}<div className="flex justify-end gap-2">{selectedId ? <Button variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : null}<Button type="submit">保存</Button></div>
    </form>
  </section>;
}

function split(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
