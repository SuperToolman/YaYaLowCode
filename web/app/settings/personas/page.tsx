"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, TrashBin } from "@gravity-ui/icons";
import { Button, Checkbox, Drawer, Input, Modal, Tabs, TextArea, Tooltip } from "@heroui/react";
import { SettingsContentCard } from "../_components/settings-content-card";
import type { AgentPersona, ApiEnvelope } from "../agent-types";

type PersonaForm = Omit<AgentPersona, "id">;
type BindableResource = { id: string; name: string; description: string; enabled: boolean };
const emptyPersona: PersonaForm = { name: "新人格", description: "", systemPrompt: "", pluginIds: [], skillIds: [], knowledgeBaseIds: [] };

export default function PersonasPage() {
  const [items, setItems] = useState<AgentPersona[]>([]);
  const [plugins, setPlugins] = useState<BindableResource[]>([]);
  const [skills, setSkills] = useState<BindableResource[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<BindableResource[]>([]);
  const [form, setForm] = useState<PersonaForm>(emptyPersona);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<AgentPersona | null>(null);
  const [tab, setTab] = useState("basic");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingPersona, setDeletingPersona] = useState(false);

  async function load() { const [response, pluginResponse, skillResponse, knowledgeResponse] = await Promise.all(["/api/agent/personas", "/api/agent/plugins", "/api/agent/skills", "/api/agent/knowledge-bases"].map((url) => fetch(url, { cache: "no-store" }))); const [payload, pluginPayload, skillPayload, knowledgePayload] = await Promise.all([response, pluginResponse, skillResponse, knowledgeResponse].map((item) => item.json())) as [ApiEnvelope<AgentPersona[]>, ApiEnvelope<BindableResource[]>, ApiEnvelope<BindableResource[]>, ApiEnvelope<BindableResource[]>]; if (!response.ok || !payload.data) throw new Error(payload.message || "无法加载人格设定"); setItems(payload.data); setPlugins(pluginPayload.data ?? []); setSkills(skillPayload.data ?? []); setKnowledgeBases(knowledgePayload.data ?? []); }
  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error) => setMessage(error instanceof Error ? error.message : "无法加载人格设定")), 0); return () => window.clearTimeout(timer); }, []);
  function openCreate() { setEditingId(null); setTab("basic"); setMessage(""); setForm({ ...emptyPersona, pluginIds: [], skillIds: [], knowledgeBaseIds: [] }); setDrawerOpen(true); }
  function openEdit(item: AgentPersona) { setEditingId(item.id); setTab("basic"); setMessage(""); setForm({ name: item.name, description: item.description, systemPrompt: item.systemPrompt, pluginIds: item.pluginIds ?? [], skillIds: item.skillIds ?? [], knowledgeBaseIds: item.knowledgeBaseIds ?? [] }); setDrawerOpen(true); }
  async function save() { setSaving(true); try { const response = await fetch(editingId ? `/api/agent/personas/${encodeURIComponent(editingId)}` : "/api/agent/personas", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); const payload = await response.json() as ApiEnvelope<AgentPersona>; if (!response.ok || !payload.data) { setMessage(payload.message || "人格设定保存失败"); return; } setDrawerOpen(false); setMessage(""); await load(); } finally { setSaving(false); } }
  async function confirmDelete() { if (!deleting) return; setDeletingPersona(true); try { const response = await fetch(`/api/agent/personas/${encodeURIComponent(deleting.id)}`, { method: "DELETE" }); const payload = await response.json() as ApiEnvelope<unknown>; if (!response.ok) { setMessage(payload.message || "人格设定删除失败"); return; } setDeleting(null); await load(); } finally { setDeletingPersona(false); } }
  const namesFor = (ids: string[], resources: BindableResource[]) => ids.map((id) => resources.find((item) => item.id === id)?.name).filter((name): name is string => Boolean(name));
  const tags = (names: string[]) => <div className="flex flex-wrap gap-1">{names.slice(0, 4).map((name) => <span key={name} className="max-w-24 truncate rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">{name}</span>)}{names.length > 4 ? <span className="rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">...</span> : null}</div>;

  return <SettingsContentCard title="人格设定" subtitle={`管理 Agent 的身份、语气、边界与默认行为。当前共 ${items.length} 个人格设定。`} bodyScrollable={false} headerActions={<Button onPress={openCreate}>新增人格设定</Button>}>
    <div className="h-full overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)]"><div className="h-full overflow-auto"><table className="min-w-[1160px] w-full table-fixed text-left text-sm"><thead className="sticky top-0 z-10 bg-[var(--color-bg-subtle)] text-xs font-medium text-[var(--color-text-secondary)]"><tr><th className="w-[16%] border-b border-[var(--color-border)] px-4 py-3">人格名称</th><th className="w-[22%] border-b border-[var(--color-border)] px-4 py-3">说明</th><th className="w-[18%] border-b border-[var(--color-border)] px-4 py-3">Skills</th><th className="w-[18%] border-b border-[var(--color-border)] px-4 py-3">插件</th><th className="w-[18%] border-b border-[var(--color-border)] px-4 py-3">知识库</th><th className="w-[8%] border-b border-[var(--color-border)] px-4 py-3">操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="hover:bg-[var(--color-control-soft-hover)]"><td className="border-b border-[var(--color-border)] px-4 py-3 font-medium text-[var(--color-text-primary)]"><span className="block truncate">{item.name}</span></td><td className="border-b border-[var(--color-border)] px-4 py-3"><span className="block truncate text-[var(--color-text-secondary)]">{item.description || "暂无说明"}</span></td><td className="border-b border-[var(--color-border)] px-4 py-2">{tags(namesFor(item.skillIds ?? [], skills))}</td><td className="border-b border-[var(--color-border)] px-4 py-2">{tags(namesFor(item.pluginIds ?? [], plugins))}</td><td className="border-b border-[var(--color-border)] px-4 py-2">{tags(namesFor(item.knowledgeBaseIds ?? [], knowledgeBases))}</td><td className="border-b border-[var(--color-border)] px-4 py-2"><div className="flex items-center gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`删除 ${item.name}`} className="text-[var(--color-danger)]" onPress={() => setDeleting(item)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip></div></td></tr>)}{items.length === 0 ? <tr><td colSpan={6} className="h-48 text-center text-[var(--color-text-secondary)]">暂无人格设定，点击“新增人格设定”创建。</td></tr> : null}</tbody></table></div></div>
    <Drawer isOpen={drawerOpen} onOpenChange={(open) => !saving && setDrawerOpen(open)}><Drawer.Backdrop className="theme-modal-backdrop" isDismissable={!saving}><Drawer.Content placement="right"><Drawer.Dialog className="flex h-[100dvh] w-[min(960px,80vw)] max-w-[96vw] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void save(); }}><Drawer.Header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4"><Drawer.Heading>{editingId ? "编辑人格设定" : "新增人格设定"}</Drawer.Heading><Drawer.CloseTrigger aria-label="关闭" isDisabled={saving} /></Drawer.Header><Drawer.Body className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"><Tabs variant="secondary" selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}><Tabs.ListContainer className="overflow-x-auto"><Tabs.List aria-label="人格设定配置" className="min-w-max"><Tabs.Tab id="basic">基础设定<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="skills">Skills<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="plugins">插件<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="knowledge">知识库<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer><Tabs.Panel id="basic" className="space-y-4 pt-4"><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">人格名称<Input className="mt-2" fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} disabled={saving} /></label><label className="block text-sm font-medium">说明<Input className="mt-2" fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} disabled={saving} /></label></div><label className="block text-sm font-medium">系统提示词<TextArea className="mt-2 min-h-80 font-mono text-sm" fullWidth value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.currentTarget.value })} disabled={saving} /></label></Tabs.Panel><Tabs.Panel id="skills" className="pt-4"><PersonaBindings title="Skills" description="此人格加载的工作流与工具使用规则。" items={skills} value={form.skillIds} onChange={(skillIds) => setForm({ ...form, skillIds })} /></Tabs.Panel><Tabs.Panel id="plugins" className="pt-4"><PersonaBindings title="插件" description="此人格可以调用的已注册插件。" items={plugins} value={form.pluginIds} onChange={(pluginIds) => setForm({ ...form, pluginIds })} /></Tabs.Panel><Tabs.Panel id="knowledge" className="pt-4"><PersonaBindings title="知识库" description="此人格可检索的领域资料。" items={knowledgeBases} value={form.knowledgeBaseIds} onChange={(knowledgeBaseIds) => setForm({ ...form, knowledgeBaseIds })} /></Tabs.Panel></Tabs>{message ? <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm">{message}</p> : null}</Drawer.Body><Drawer.Footer className="shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3"><Button variant="ghost" isDisabled={saving} onPress={() => setDrawerOpen(false)}>取消</Button><Button type="submit" isDisabled={saving || !form.name.trim()}>{saving ? "保存中…" : "保存"}</Button></Drawer.Footer></form></Drawer.Dialog></Drawer.Content></Drawer.Backdrop></Drawer>
    <Modal isOpen={Boolean(deleting)} onOpenChange={(open) => !deletingPersona && !open && setDeleting(null)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!deletingPersona}><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>删除人格设定</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={deletingPersona} /></Modal.Header><Modal.Body><p className="text-sm text-[var(--color-text-secondary)]">确认删除“{deleting?.name}”吗？正在使用该人格的配置文件可能需要重新设置人格。</p></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={deletingPersona} onPress={() => setDeleting(null)}>取消</Button><Button isDisabled={deletingPersona} className="bg-[var(--color-danger)] text-white" onPress={() => void confirmDelete()}>{deletingPersona ? "删除中…" : "删除"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </SettingsContentCard>;
}

function LegacyPersonasPage() {
  const [items, setItems] = useState<AgentPersona[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<PersonaForm>(emptyPersona);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [plugins, setPlugins] = useState<BindableResource[]>([]);
  const [skills, setSkills] = useState<BindableResource[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<BindableResource[]>([]);

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return items;
    return items.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(keyword));
  }, [items, query]);

  async function load(preferredId = selectedId) {
    const [response, pluginResponse, skillResponse, knowledgeResponse] = await Promise.all(["/api/agent/personas", "/api/agent/plugins", "/api/agent/skills", "/api/agent/knowledge-bases"].map((url) => fetch(url, { cache: "no-store" })));
    const [payload, pluginPayload, skillPayload, knowledgePayload] = await Promise.all([response, pluginResponse, skillResponse, knowledgeResponse].map((item) => item.json())) as [ApiEnvelope<AgentPersona[]>, ApiEnvelope<BindableResource[]>, ApiEnvelope<BindableResource[]>, ApiEnvelope<BindableResource[]>];
    if (!response.ok || !payload.data) throw new Error(payload.message || "无法加载人格");
    setItems(payload.data);
    setPlugins(pluginPayload.data ?? []); setSkills(skillPayload.data ?? []); setKnowledgeBases(knowledgePayload.data ?? []);
    const current = payload.data.find((item) => item.id === preferredId) ?? payload.data[0];
    if (current) select(current); else { setSelectedId(null); setForm(emptyPersona); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setMessage(error instanceof Error ? error.message : "无法加载人格"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function select(item: AgentPersona) { setSelectedId(item.id); setForm({ name: item.name, description: item.description, systemPrompt: item.systemPrompt, pluginIds: item.pluginIds ?? [], skillIds: item.skillIds ?? [], knowledgeBaseIds: item.knowledgeBaseIds ?? [] }); setMessage(""); }
  function create() { setSelectedId(null); setForm(emptyPersona); setMessage(""); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(selectedId ? `/api/agent/personas/${encodeURIComponent(selectedId)}` : "/api/agent/personas", { method: selectedId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const payload = await response.json() as ApiEnvelope<AgentPersona>;
    if (!response.ok || !payload.data) { setMessage(payload.message || "人格保存失败"); return; }
    setMessage("人格已保存"); await load(payload.data.id);
  }

  async function remove() {
    if (!selectedId) return;
    const response = await fetch(`/api/agent/personas/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
    const payload = await response.json() as ApiEnvelope<unknown>;
    if (!response.ok) { setMessage(payload.message || "人格删除失败"); return; }
    setMessage("人格已删除"); setSelectedId(null); await load(null);
  }

  return <SettingsContentCard title="人格" subtitle="管理 Agent 的身份、语气、边界与默认行为；每个配置文件可绑定一个人格。" bodyScrollable={false} bodyClassName="mt-5" headerActions={<Button onPress={create}>新增人格</Button>}>
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="theme-panel flex min-h-[280px] min-w-0 flex-col overflow-clip rounded-lg shadow-[var(--shadow-card)] xl:min-h-0">
        <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">人格</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">定义角色定位与系统提示词。</p></div><span className="shrink-0 rounded-md bg-[var(--color-control-soft)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">{items.length}</span></div><Input aria-label="搜索人格" className="mt-3" fullWidth placeholder="搜索名称或说明" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></header>
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-label="人格列表"><div className="space-y-1">{visibleItems.map((item) => <Button key={item.id} fullWidth variant="ghost" onPress={() => select(item)} className={`h-auto min-h-[68px] justify-start rounded-md px-3 py-2 text-left ${item.id === selectedId ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{item.description || "暂无说明"}</span></span></Button>)}{!visibleItems.length ? <p className="px-3 py-8 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配的人格" : "尚未创建人格"}</p> : null}</div></nav>
      </aside>
      <form onSubmit={(event) => void save(event)} className="theme-panel flex min-h-0 min-w-0 flex-col overflow-clip rounded-lg shadow-[var(--shadow-card)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4"><div className="min-w-0"><h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">{selectedId ? form.name || "未命名人格" : "新增人格"}</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">系统提示词会在每次 Agent 运行时载入。</p></div><div className="flex shrink-0 gap-2">{selectedId ? <Button type="button" variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : null}<Button type="submit" isDisabled={!form.name.trim()}>保存</Button></div></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="mx-auto max-w-4xl space-y-5"><section className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">人格名称<Input className="mt-2" fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label><label className="block text-sm font-medium">说明<Input className="mt-2" fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></label></section><label className="block text-sm font-medium">系统提示词<TextArea className="mt-2 min-h-80 font-mono text-sm" fullWidth value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.currentTarget.value })} /></label><PersonaBindings title="插件" description="此人格可以调用的已注册插件。" items={plugins} value={form.pluginIds} onChange={(pluginIds) => setForm({ ...form, pluginIds })} /><PersonaBindings title="Skills" description="此人格加载的工作流与工具使用规则。" items={skills} value={form.skillIds} onChange={(skillIds) => setForm({ ...form, skillIds })} /><PersonaBindings title="知识库" description="此人格可检索的领域资料。" items={knowledgeBases} value={form.knowledgeBaseIds} onChange={(knowledgeBaseIds) => setForm({ ...form, knowledgeBaseIds })} />{message ? <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}</div></div>
      </form>
    </div>
  </SettingsContentCard>;
}

function PersonaBindings({ title, description, items, value, onChange }: { title: string; description: string; items: BindableResource[]; value: string[]; onChange: (value: string[]) => void }) {
  return <section className="rounded-lg border border-[var(--color-border)] p-4"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{items.map((item) => <Checkbox key={item.id} isSelected={value.includes(item.id)} isDisabled={!item.enabled} onChange={(checked) => onChange(checked ? [...value, item.id] : value.filter((id) => id !== item.id))} className="items-start rounded-md border border-[var(--color-border)] p-3"><Checkbox.Control className="mt-0.5"><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content><span className="block text-sm font-medium">{item.name}</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{item.description || "暂无说明"}</span></Checkbox.Content></Checkbox>)}{items.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">暂无可用资源</p> : null}</div></section>;
}
