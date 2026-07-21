"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, Select, Switch, TextArea } from "@heroui/react";
import { Field } from "./field";
import type { ApiEnvelope } from "../agent-types";

type Kind = "plugin" | "skill" | "knowledge";
type Resource = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  version?: string;
  entrypoint?: string;
  manifestJson?: string;
  packageName?: string;
  packagePath?: string;
  source?: string;
  isSystem?: boolean;
  requiresConfirmation?: boolean;
  allowedTools?: string[];
  instructions?: string;
  retrievalMode?: string;
  content?: string;
  sourceIds?: string[];
};
type PlatformTool = { id: string; name: string; description: string; category: string; riskLevel: "read" | "write" | "external" };

const meta = {
  plugin: { title: "插件", description: "受控的 Agent 外部工具扩展", endpoint: "/api/agent/plugins" },
  skill: { title: "Skills", description: "Agent 工作流和内置工具使用规则", endpoint: "/api/agent/skills" },
  knowledge: { title: "知识库", description: "Agent 可检索的领域资料", endpoint: "/api/agent/knowledge-bases" },
} as const;

function empty(kind: Kind): Omit<Resource, "id"> {
  return {
    name: `新${meta[kind].title}`,
    description: "",
    enabled: true,
    version: kind === "plugin" ? "0.1.0" : undefined,
    entrypoint: "",
    manifestJson: "",
    requiresConfirmation: kind === "knowledge" ? undefined : false,
    allowedTools: [],
    instructions: "",
    retrievalMode: kind === "knowledge" ? "keyword" : undefined,
    content: "",
    sourceIds: [],
  };
}

export function AgentResourcePage({ kind }: { kind: Kind }) {
  const config = meta[kind];
  const [items, setItems] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Resource, "id">>(() => empty(kind));
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [platformTools, setPlatformTools] = useState<PlatformTool[]>([]);

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return items;
    return items.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(keyword));
  }, [items, query]);

  async function load(preferredId = selectedId) {
    const response = await fetch(config.endpoint, { cache: "no-store" });
    const payload = (await response.json()) as ApiEnvelope<Resource[]>;
    if (!response.ok || !payload.data) throw new Error(payload.message);
    setItems(payload.data);
    const current = payload.data.find((item) => item.id === preferredId) ?? payload.data[0];
    if (current) select(current); else { setSelectedId(null); setForm(empty(kind)); }
    if (kind === "skill") {
      const toolResponse = await fetch("/api/agent/platform-tools", { cache: "no-store" });
      const toolPayload = (await toolResponse.json()) as ApiEnvelope<PlatformTool[]>;
      if (toolResponse.ok && toolPayload.data) setPlatformTools(toolPayload.data);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((error) => setMessage(String(error))); }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function create() { setSelectedId(null); setForm(empty(kind)); setMessage(""); }
  function select(item: Resource) { const { id, ...next } = item; setSelectedId(id); setForm(next); setMessage(""); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const url = selectedId ? `${config.endpoint}/${encodeURIComponent(selectedId)}` : config.endpoint;
    const body = kind === "knowledge" ? { ...form, retrievalMode: "keyword" } : form;
    const response = await fetch(url, { method: selectedId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json()) as ApiEnvelope<Resource>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setMessage(`${config.title}已保存`); setSelectedId(payload.data.id); await load(payload.data.id);
  }

  async function remove(id = selectedId) {
    if (!id) return;
    const response = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    if (!response.ok) return setMessage(payload.message);
    if (selectedId === id) { setSelectedId(null); setForm(empty(kind)); }
    setMessage(`${config.title}已删除`); await load(selectedId === id ? null : selectedId);
  }

  async function setSkillEnabled(item: Resource, enabled: boolean) {
    const { id, ...body } = item;
    const response = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, enabled }),
    });
    const payload = (await response.json()) as ApiEnvelope<Resource>;
    if (!response.ok || !payload.data) {
      setMessage(payload.message || "无法更新 Skill 状态");
      return;
    }
    const updated = payload.data;
    setItems((current) => current.map((candidate) => candidate.id === id ? updated : candidate));
    if (selectedId === id) select(updated);
  }

  if (kind === "skill") {
    return <section className="h-full min-h-0 overflow-y-auto px-1 py-2 sm:px-3">
      <header className="mx-auto max-w-6xl border-b border-[var(--color-border)] pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Skills</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">本地 Skill 配置会作为 Agent 的可复用工作流加载。Skill 只能调用管理员批准的平台工具；外部执行能力仍须通过受控插件提供。</p></div>
          <Button onPress={create}>新建 Skill</Button>
        </div>
        <Input aria-label="搜索 Skills" className="mt-4 max-w-sm" placeholder="搜索名称或描述" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </header>
      {message ? <p className="mx-auto mt-4 max-w-6xl rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
      <div className="mx-auto max-w-6xl py-5">
        <div className="space-y-3">
          {visibleItems.map((item) => <SkillPackageCard key={item.id} item={item} selected={item.id === selectedId} onSelect={() => select(item)} onToggle={(enabled) => void setSkillEnabled(item, enabled)} onDelete={() => void remove(item.id)} />)}
          {!visibleItems.length ? <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配的 Skill" : "尚未安装 Skill"}</p> : null}
        </div>
        <form onSubmit={save} className="mt-6 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4"><div><h3 className="text-base font-semibold text-[var(--color-text-primary)]">{selectedId ? `配置 ${form.name || "Skill"}` : "新建本地 Skill"}</h3><p className="mt-1 text-xs text-[var(--color-text-secondary)]">当前版本将运行指令和受控工具授权作为一个本地 Skill 配置保存。</p></div><div className="flex gap-2">{selectedId ? <Button type="button" variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : null}<Button type="submit">保存</Button></div></header>
          <div className="space-y-5 p-5"><section className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></section><SkillFields form={form} setForm={setForm} tools={platformTools} /><section className="flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content>启用 Skill</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch><Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content>执行前需确认</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch></section></div>
        </form>
      </div>
    </section>;
  }

  return <section className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
    <aside className="theme-panel flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-lg shadow-[var(--shadow-card)] xl:min-h-0">
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{config.title}</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{config.description}</p></div>
          <span className="shrink-0 rounded-md bg-[var(--color-control-soft)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">{items.length}</span>
        </div>
        <div className="mt-3 flex gap-2"><Input aria-label={`搜索${config.title}`} fullWidth placeholder="搜索名称或描述" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Button className="shrink-0" onPress={create}>新增</Button></div>
      </header>
      <nav aria-label={`${config.title}列表`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <ul className="space-y-1">
          {visibleItems.map((item) => <ResourceListItem key={item.id} item={item} kind={kind} selected={item.id === selectedId} onSelect={() => select(item)} />)}
        </ul>
        {!visibleItems.length ? <p className="px-3 py-8 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配的资源" : `尚未创建${config.title}`}</p> : null}
      </nav>
    </aside>

    <form onSubmit={save} className="theme-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg shadow-[var(--shadow-card)]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0"><h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">{selectedId ? form.name || `未命名${config.title}` : `新增${config.title}`}</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selectedId ? "编辑资源配置" : "创建新的资源配置"}</p></div>
        <div className="flex shrink-0 gap-2">{selectedId ? <Button variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : null}<Button type="submit">保存</Button></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-4xl space-y-5">
          <section className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></section>
          {kind === "plugin" ? <PluginFields form={form} setForm={setForm} /> : null}
          {kind === "knowledge" ? <KnowledgeFields form={form} setForm={setForm} /> : null}
          <section className="flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content>启用资源</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch>{kind !== "knowledge" ? <Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content>执行前需确认</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch> : null}</section>
          {message ? <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
        </div>
      </div>
    </form>
  </section>;
}

function ResourceListItem({ item, kind, selected, onSelect }: { item: Resource; kind: Kind; selected: boolean; onSelect: () => void }) {
  return <li><Button variant="ghost" fullWidth onPress={onSelect} aria-pressed={selected} className={`h-auto min-h-[76px] justify-start rounded-md px-3 py-2.5 text-left ${selected ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"}`}><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.name}</span><StatusBadge enabled={item.enabled} /></span><span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{item.description || "暂无描述"}</span><span className="mt-2 block truncate text-[11px] text-[var(--color-text-secondary)]">{resourceSummary(item, kind)}</span></span></Button></li>;
}

function StatusBadge({ enabled }: { enabled: boolean }) { return <span className={enabled ? "shrink-0 rounded-md bg-[var(--color-success-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-success)]" : "shrink-0 rounded-md bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-danger)]"}>{enabled ? "已启用" : "已停用"}</span>; }

function SkillPackageCard({ item, selected, onSelect, onToggle, onDelete }: { item: Resource; selected: boolean; onSelect: () => void; onToggle: (enabled: boolean) => void; onDelete: () => void }) {
  return <article className={`rounded-lg border bg-[var(--color-bg-surface)] px-4 py-4 transition ${selected ? "border-[var(--color-primary)] shadow-[var(--shadow-card)]" : "border-[var(--color-border)] hover:border-[var(--color-primary)]"}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left" aria-pressed={selected}>
        <span className="flex flex-wrap items-center gap-2"><span className="text-base font-semibold text-[var(--color-text-primary)]">{item.name}</span><span className="rounded-md bg-[var(--color-info-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-info)]">{item.source === "system" ? "系统 Skill" : "本地 Skill"}</span></span>
        <span className="mt-2 block truncate text-sm text-[var(--color-text-secondary)]">{item.description || "暂无描述"}</span>
        <span className="mt-3 block truncate font-mono text-xs text-[var(--color-text-secondary)]">路径: {item.packagePath || "待初始化"} · {item.allowedTools?.length ?? 0} 个已授权工具</span>
      </button>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto"><Button type="button" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={onSelect}>编辑</Button><Button type="button" variant="ghost" aria-label={`删除 ${item.name}`} className="text-[var(--color-danger)]" onPress={onDelete}>删除</Button><Switch aria-label={`启用 ${item.name}`} isSelected={item.enabled} onChange={onToggle}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></div>
    </div>
  </article>;
}

function resourceSummary(item: Resource, kind: Kind) {
  if (kind === "skill") return `${item.allowedTools?.length ?? 0} 个允许工具`;
  if (kind === "knowledge") return `${item.content?.trim().length ?? 0} 字符内容${item.sourceIds?.length ? ` · ${item.sourceIds.length} 个外部来源` : ""}`;
  return `${item.version || "未设版本"}${item.entrypoint ? ` · ${item.entrypoint}` : " · 未设入口"}`;
}

function PluginFields({ form, setForm }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>> }) { return <section className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="版本"><Input fullWidth value={form.version ?? ""} onChange={(event) => setForm({ ...form, version: event.currentTarget.value })} /></Field><Field label="入口标识"><Input fullWidth value={form.entrypoint ?? ""} onChange={(event) => setForm({ ...form, entrypoint: event.currentTarget.value })} placeholder="vendor.plugin" /></Field></div><Field label="工具 Manifest" hint="HTTP JSON 协议。需包含 endpoint 和 tools；需要人工确认的工具不会自动调用。"><TextArea fullWidth className="min-h-48 font-mono text-sm" value={form.manifestJson ?? ""} onChange={(event) => setForm({ ...form, manifestJson: event.currentTarget.value })} placeholder={'{"endpoint":"https://plugin.example.com/agent-tools","tools":[{"name":"lookup","description":"查询外部数据"}]}'}/></Field></section>; }
function SkillFields({ form, setForm, tools }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>>; tools: PlatformTool[] }) { const selected = form.allowedTools ?? []; return <section className="space-y-4"><Field label="允许工具" hint="Skill 只能请求此处选中的平台工具。写入和外部工具还会经过 Profile 与运行时策略校验。"><div className="grid gap-2 sm:grid-cols-2">{tools.map((tool) => <Checkbox key={tool.id} isSelected={selected.includes(tool.id)} onChange={(checked) => setForm({ ...form, allowedTools: checked ? [...selected, tool.id] : selected.filter((id) => id !== tool.id) })} className="items-start rounded-md border border-[var(--color-border)] p-3"><Checkbox.Control className="mt-0.5"><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content><span className="flex items-center gap-2 text-sm font-medium">{tool.name}<span className={tool.riskLevel === "read" ? "rounded bg-[var(--color-success-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-success)]" : "rounded bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-danger)]"}>{tool.riskLevel === "read" ? "读取" : tool.riskLevel === "write" ? "写入" : "外部"}</span></span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{tool.description}</span></Checkbox.Content></Checkbox>)}</div></Field><Field label="运行指令" hint="当配置文件绑定此 Skill 时，Agent 会遵循这些指令。"><TextArea fullWidth className="min-h-40 font-mono text-sm" value={form.instructions ?? ""} onChange={(event) => setForm({ ...form, instructions: event.currentTarget.value })} /></Field></section>; }
function KnowledgeFields({ form, setForm }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>> }) { return <section className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="检索模式"><Select aria-label="检索模式" fullWidth selectedKey="keyword" isDisabled><Select.Trigger><Select.Value>关键词检索</Select.Value><Select.Indicator /></Select.Trigger></Select></Field><Field label="外部数据源 IDs"><Input fullWidth value={(form.sourceIds ?? []).join(", ")} onChange={(event) => setForm({ ...form, sourceIds: split(event.currentTarget.value) })} /></Field></div><Field label="知识内容" hint="当前版本会按关键词检索该内容并提供相关片段给 Agent。"><TextArea fullWidth className="min-h-56 font-mono text-sm" value={form.content ?? ""} onChange={(event) => setForm({ ...form, content: event.currentTarget.value, retrievalMode: "keyword" })} /></Field></section>; }

function split(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
