"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, TrashBin } from "@gravity-ui/icons";
import { Button, Checkbox, Chip, Drawer, Input, Modal, Select, Switch, Table, TextArea, Tooltip } from "@heroui/react";
import { Field } from "./field";
import { SettingsContentCard } from "./settings-content-card";
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
  const [isSkillEditorOpen, setIsSkillEditorOpen] = useState(false);
  const [isPluginEditorOpen, setIsPluginEditorOpen] = useState(false);
  const [isKnowledgeEditorOpen, setIsKnowledgeEditorOpen] = useState(false);
  const [deletingPlugin, setDeletingPlugin] = useState<Resource | null>(null);
  const [deletingKnowledge, setDeletingKnowledge] = useState<Resource | null>(null);
  const [form, setForm] = useState<Omit<Resource, "id">>(() => empty(kind));
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [platformTools, setPlatformTools] = useState<PlatformTool[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

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

  function create() { setSelectedId(null); setForm(empty(kind)); setMessage(""); if (kind === "skill") setIsSkillEditorOpen(true); if (kind === "plugin") setIsPluginEditorOpen(true); if (kind === "knowledge") setIsKnowledgeEditorOpen(true); }
  function select(item: Resource) { const { id, ...next } = item; setSelectedId(id); setForm(next); setMessage(""); }
  function editSkill(item: Resource) { select(item); setIsSkillEditorOpen(true); }
  function editPlugin(item: Resource) { select(item); setIsPluginEditorOpen(true); }
  function editKnowledge(item: Resource) { select(item); setIsKnowledgeEditorOpen(true); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const url = selectedId ? `${config.endpoint}/${encodeURIComponent(selectedId)}` : config.endpoint;
    const body = kind === "knowledge" ? { ...form, retrievalMode: "keyword" } : form;
    const response = await fetch(url, { method: selectedId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json()) as ApiEnvelope<Resource>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setMessage(`${config.title}已保存`); setSelectedId(payload.data.id); await load(payload.data.id);
    if (kind === "skill") setIsSkillEditorOpen(false);
    if (kind === "plugin") setIsPluginEditorOpen(false);
    if (kind === "knowledge") setIsKnowledgeEditorOpen(false);
  }

  async function remove(id = selectedId) {
    if (!id) return;
    const response = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    if (!response.ok) return setMessage(payload.message);
    if (selectedId === id) { setSelectedId(null); setForm(empty(kind)); if (kind === "skill") setIsSkillEditorOpen(false); }
    setMessage(`${config.title}已删除`); await load(selectedId === id ? null : selectedId);
  }

  async function confirmKnowledgeRemoval() {
    if (!deletingKnowledge) return;
    const id = deletingKnowledge.id;
    const response = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    if (!response.ok) {
      setMessage(payload.message || "知识库删除失败");
      return;
    }
    setDeletingKnowledge(null);
    if (selectedId === id) {
      setSelectedId(null);
      setForm(empty(kind));
      setIsKnowledgeEditorOpen(false);
    }
    setMessage("知识库已删除");
    await load(selectedId === id ? null : selectedId);
  }

  async function confirmPluginRemoval() {
    if (!deletingPlugin) return;
    const id = deletingPlugin.id;
    const response = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    if (!response.ok) {
      setMessage(payload.message || "插件删除失败");
      return;
    }
    setDeletingPlugin(null);
    if (selectedId === id) {
      setSelectedId(null);
      setForm(empty(kind));
      setIsPluginEditorOpen(false);
    }
    setMessage("插件已删除");
    await load(selectedId === id ? null : selectedId);
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

  async function importSkill(file: File) {
    if (!file.name.toLocaleLowerCase().endsWith(".zip")) {
      setMessage("请选择 .zip 格式的 Skill 压缩包");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/agent/skills/import", { method: "POST", body });
    const payload = (await response.json()) as ApiEnvelope<Resource>;
    if (!response.ok || !payload.data) {
      setMessage(payload.message || "Skill 导入失败");
      return;
    }
    setMessage(`已导入 Skill：${payload.data.name}`);
    await load(payload.data.id);
  }

  if (kind === "skill") {
    const skillActions = <><input ref={importInputRef} className="sr-only" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importSkill(file); }} /><Input aria-label="搜索 Skills" className="w-full sm:w-64" placeholder="搜索名称或描述" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Button variant="secondary" onPress={() => importInputRef.current?.click()}>导入 ZIP</Button><Button onPress={create}>新建本地 Skill</Button></>;
    return <SettingsContentCard title="Skills" subtitle="管理可复用的 Agent 工作流、运行指令与平台工具授权。" headerActions={skillActions} bodyScrollable={false} bodyClassName="agent-resource-settings-body"><section className="flex h-full min-h-0 flex-col gap-4">
      {message ? <p className="mx-auto rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
      <Table className="min-h-0 flex-1"><Table.ScrollContainer className="h-full overflow-auto"><Table.Content aria-label="Skills" className="min-w-[960px] w-full table-fixed"><Table.Header><Table.Column id="name" isRowHeader className="w-[18%]">名称</Table.Column><Table.Column id="source" className="w-[8%]">来源</Table.Column><Table.Column id="description" className="w-[22%]">说明</Table.Column><Table.Column id="path" className="w-[23%]">安装路径</Table.Column><Table.Column id="tools" className="w-[12%]">已授权工具</Table.Column><Table.Column id="status" className="w-[7%]">状态</Table.Column><Table.Column id="actions" className="w-[10%]">操作</Table.Column></Table.Header><Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配的 Skill" : "尚未安装 Skill"}</p>}><Table.Collection items={visibleItems}>{(item) => <Table.Row key={item.id} id={item.id}><Table.Cell><span className="block truncate font-medium">{item.name}</span></Table.Cell><Table.Cell><Chip size="sm" color={item.source === "system" ? "accent" : "default"} variant="soft">{item.source === "system" ? "系统 Skill" : "本地 Skill"}</Chip></Table.Cell><Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{item.description || "暂无描述"}</span></Table.Cell><Table.Cell><span className="block truncate font-mono text-xs text-[var(--color-text-secondary)]">{item.packagePath || "待初始化"}</span></Table.Cell><Table.Cell>{item.allowedTools?.length ?? 0} 个</Table.Cell><Table.Cell><StatusBadge enabled={item.enabled} /></Table.Cell><Table.Cell><div className="flex items-center gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly type="button" size="sm" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={() => editSkill(item)}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly type="button" size="sm" variant="ghost" aria-label={`删除 ${item.name}`} className="text-[var(--color-danger)]" onPress={() => void remove(item.id)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip><Switch aria-label={`启用 ${item.name}`} isSelected={item.enabled} onChange={(enabled) => void setSkillEnabled(item, enabled)}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch></div></Table.Cell></Table.Row>}</Table.Collection></Table.Body></Table.Content></Table.ScrollContainer></Table>
      <Drawer isOpen={isSkillEditorOpen} onOpenChange={setIsSkillEditorOpen}>
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
          <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-[100dvh] w-[min(960px,96vw)] max-w-[96vw] flex-col overflow-hidden bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                <Drawer.Header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4"><div><Drawer.Heading className="text-lg font-semibold">{selectedId ? `编辑 ${form.name || "Skill"}` : "新建本地 Skill"}</Drawer.Heading><p className="mt-1 text-xs text-[var(--color-text-secondary)]">配置运行指令和受控工具授权。</p></div><Drawer.CloseTrigger aria-label="关闭" /></Drawer.Header>
                <Drawer.Body className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"><section className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input autoFocus fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></section><SkillFields form={form} setForm={setForm} tools={platformTools} /><section className="flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用 Skill</Switch.Content></Switch><Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>执行前需确认</Switch.Content></Switch></section></Drawer.Body>
                <Drawer.Footer className="shrink-0 justify-between border-t border-[var(--color-border)] px-5 py-3">{selectedId ? <Button type="button" variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : <span />}<div className="flex gap-2"><Button type="button" variant="ghost" onPress={() => setIsSkillEditorOpen(false)}>取消</Button><Button type="submit">保存</Button></div></Drawer.Footer>
              </form>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </section></SettingsContentCard>;
  }

  if (kind === "knowledge") {
    const knowledgeActions = <><Input aria-label="搜索知识库" className="w-full sm:w-72" placeholder="搜索名称或描述" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Button onPress={create}>新增知识库</Button></>;
    return <SettingsContentCard title={meta.knowledge.title} subtitle="管理 Agent 可检索的业务资料与外部数据源引用。" headerActions={knowledgeActions} bodyScrollable={false} bodyClassName="agent-resource-settings-body">
      <section className="flex h-full min-h-0 flex-col gap-4">
      {message ? <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
      <Table className="min-h-0 flex-1">
        <Table.ScrollContainer className="h-full overflow-auto">
          <Table.Content aria-label="知识库" className="min-w-[960px] w-full table-fixed">
            <Table.Header><Table.Column id="name" isRowHeader className="w-[18%]">名称</Table.Column><Table.Column id="description" className="w-[22%]">说明</Table.Column><Table.Column id="mode" className="w-[12%]">检索模式</Table.Column><Table.Column id="content" className="w-[18%]">知识内容</Table.Column><Table.Column id="sources" className="w-[15%]">外部数据源</Table.Column><Table.Column id="status" className="w-[7%]">状态</Table.Column><Table.Column id="actions" className="w-[8%]">操作</Table.Column></Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配的知识库" : "暂无知识库，点击“新增知识库”创建。"}</p>}><Table.Collection items={visibleItems}>{(item) => <Table.Row key={item.id} id={item.id}><Table.Cell><span className="block truncate font-medium">{item.name}</span></Table.Cell><Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{item.description || "暂无说明"}</span></Table.Cell><Table.Cell>关键词检索</Table.Cell><Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{item.content?.trim() || "暂无内容"}</span></Table.Cell><Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{item.sourceIds?.join(", ") || "未关联"}</span></Table.Cell><Table.Cell><StatusBadge enabled={item.enabled} /></Table.Cell><Table.Cell><div className="flex items-center gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={() => editKnowledge(item)}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`删除 ${item.name}`} className="text-[var(--color-danger)]" onPress={() => setDeletingKnowledge(item)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip></div></Table.Cell></Table.Row>}</Table.Collection></Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <Drawer isOpen={isKnowledgeEditorOpen} onOpenChange={setIsKnowledgeEditorOpen}><Drawer.Backdrop className="theme-modal-backdrop" isDismissable><Drawer.Content placement="right"><Drawer.Dialog className="flex h-[100dvh] w-[min(960px,80vw)] max-w-[96vw] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><form className="flex min-h-0 flex-1 flex-col" onSubmit={save}><Drawer.Header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4"><Drawer.Heading>{selectedId ? "编辑知识库" : "新增知识库"}</Drawer.Heading><Drawer.CloseTrigger aria-label="关闭" /></Drawer.Header><Drawer.Body className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"><section className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input autoFocus fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></section><KnowledgeFields form={form} setForm={setForm} /><section className="border-t border-[var(--color-border)] pt-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用知识库</Switch.Content></Switch></section></Drawer.Body><Drawer.Footer className="shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3"><Button type="button" variant="ghost" onPress={() => setIsKnowledgeEditorOpen(false)}>取消</Button><Button type="submit" isDisabled={!form.name.trim()}>保存</Button></Drawer.Footer></form></Drawer.Dialog></Drawer.Content></Drawer.Backdrop></Drawer>
      <Modal isOpen={Boolean(deletingKnowledge)} onOpenChange={(open) => !open && setDeletingKnowledge(null)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>删除知识库</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><Modal.Body><p className="text-sm text-[var(--color-text-secondary)]">确认删除“{deletingKnowledge?.name}”吗？关联该知识库的人格将无法继续检索其内容。</p></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => setDeletingKnowledge(null)}>取消</Button><Button className="bg-[var(--color-danger)] text-white" onPress={() => void confirmKnowledgeRemoval()}>删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
      </section>
    </SettingsContentCard>;
  }

  if (kind === "plugin") {
    const pluginActions = <><Input aria-label="搜索插件" className="w-full sm:w-72" placeholder="搜索名称或描述" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Button onPress={create}>新增插件</Button></>;
    return <SettingsContentCard title={meta.plugin.title} subtitle="管理 Agent 可调用的外部工具扩展、连接配置与执行确认策略。" headerActions={pluginActions} bodyScrollable={false} bodyClassName="agent-resource-settings-body">
      <section className="flex h-full min-h-0 flex-col gap-4">
      {message ? <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
      <Table className="min-h-0 flex-1"><Table.ScrollContainer className="h-full overflow-auto"><Table.Content aria-label="插件" className="min-w-[960px] w-full table-fixed"><Table.Header><Table.Column id="name" isRowHeader className="w-[18%]">名称</Table.Column><Table.Column id="description" className="w-[22%]">说明</Table.Column><Table.Column id="version" className="w-[12%]">版本</Table.Column><Table.Column id="entrypoint" className="w-[18%]">入口标识</Table.Column><Table.Column id="confirmation" className="w-[13%]">执行确认</Table.Column><Table.Column id="status" className="w-[9%]">状态</Table.Column><Table.Column id="actions" className="w-[8%]">操作</Table.Column></Table.Header><Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配的插件" : "暂无插件，点击“新增插件”创建。"}</p>}><Table.Collection items={visibleItems}>{(item) => <Table.Row key={item.id} id={item.id}><Table.Cell><span className="block truncate font-medium">{item.name}</span></Table.Cell><Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{item.description || "暂无说明"}</span></Table.Cell><Table.Cell>{item.version || "未设版本"}</Table.Cell><Table.Cell><span className="block truncate font-mono text-xs text-[var(--color-text-secondary)]">{item.entrypoint || "未设入口"}</span></Table.Cell><Table.Cell>{item.requiresConfirmation ? "执行前确认" : "自动执行"}</Table.Cell><Table.Cell><StatusBadge enabled={item.enabled} /></Table.Cell><Table.Cell><div className="flex items-center gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={() => editPlugin(item)}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`删除 ${item.name}`} className="text-[var(--color-danger)]" onPress={() => setDeletingPlugin(item)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip></div></Table.Cell></Table.Row>}</Table.Collection></Table.Body></Table.Content></Table.ScrollContainer></Table>
      <Drawer isOpen={isPluginEditorOpen} onOpenChange={setIsPluginEditorOpen}><Drawer.Backdrop className="theme-modal-backdrop" isDismissable><Drawer.Content placement="right"><Drawer.Dialog className="flex h-[100dvh] w-[min(960px,80vw)] max-w-[96vw] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><form className="flex min-h-0 flex-1 flex-col" onSubmit={save}><Drawer.Header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4"><Drawer.Heading>{selectedId ? "编辑插件" : "新增插件"}</Drawer.Heading><Drawer.CloseTrigger aria-label="关闭" /></Drawer.Header><Drawer.Body className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"><section className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input autoFocus fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></section><PluginFields form={form} setForm={setForm} /><section className="flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用插件</Switch.Content></Switch><Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>执行前需确认</Switch.Content></Switch></section></Drawer.Body><Drawer.Footer className="shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3"><Button type="button" variant="ghost" onPress={() => setIsPluginEditorOpen(false)}>取消</Button><Button type="submit" isDisabled={!form.name.trim()}>保存</Button></Drawer.Footer></form></Drawer.Dialog></Drawer.Content></Drawer.Backdrop></Drawer>
      <Modal isOpen={Boolean(deletingPlugin)} onOpenChange={(open) => !open && setDeletingPlugin(null)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>删除插件</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><Modal.Body><p className="text-sm text-[var(--color-text-secondary)]">确认删除“{deletingPlugin?.name}”吗？使用该插件的人格与配置文件将无法继续调用它。</p></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => setDeletingPlugin(null)}>取消</Button><Button className="bg-[var(--color-danger)] text-white" onPress={() => void confirmPluginRemoval()}>删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
      </section>
    </SettingsContentCard>;
  }

  return <section className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
    <aside className="theme-panel flex min-h-[280px] min-w-0 flex-col overflow-clip rounded-lg shadow-[var(--shadow-card)] xl:min-h-0">
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

    <form onSubmit={save} className="theme-panel flex min-h-0 min-w-0 flex-col overflow-clip rounded-lg shadow-[var(--shadow-card)]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0"><h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">{selectedId ? form.name || `未命名${config.title}` : `新增${config.title}`}</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selectedId ? "编辑资源配置" : "创建新的资源配置"}</p></div>
        <div className="flex shrink-0 gap-2">{selectedId ? <Button variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : null}<Button type="submit">保存</Button></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-4xl space-y-5">
          <section className="grid gap-4 sm:grid-cols-2"><Field label="名称"><Input fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field></section>
          <PluginFields form={form} setForm={setForm} />
          <section className="flex flex-wrap gap-6 border-t border-[var(--color-border)] pt-5"><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用资源</Switch.Content></Switch><Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>执行前需确认</Switch.Content></Switch></section>
          {message ? <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-primary)]">{message}</p> : null}
        </div>
      </div>
    </form>
  </section>;
}

function ResourceListItem({ item, kind, selected, onSelect }: { item: Resource; kind: Kind; selected: boolean; onSelect: () => void }) {
  return <li><Button variant="ghost" fullWidth onPress={onSelect} aria-pressed={selected} className={`h-auto min-h-[76px] justify-start rounded-md px-3 py-2.5 text-left ${selected ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"}`}><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.name}</span><StatusBadge enabled={item.enabled} /></span><span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">{item.description || "暂无描述"}</span><span className="mt-2 block truncate text-[11px] text-[var(--color-text-secondary)]">{resourceSummary(item, kind)}</span></span></Button></li>;
}

function StatusBadge({ enabled }: { enabled: boolean }) { return <Chip size="sm" color={enabled ? "success" : "danger"} variant="soft">{enabled ? "已启用" : "已停用"}</Chip>; }

function resourceSummary(item: Resource, kind: Kind) {
  if (kind === "skill") return `${item.allowedTools?.length ?? 0} 个允许工具`;
  if (kind === "knowledge") return `${item.content?.trim().length ?? 0} 字符内容${item.sourceIds?.length ? ` · ${item.sourceIds.length} 个外部来源` : ""}`;
  return `${item.version || "未设版本"}${item.entrypoint ? ` · ${item.entrypoint}` : " · 未设入口"}`;
}

function PluginFields({ form, setForm }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>> }) { return <section className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="版本"><Input fullWidth value={form.version ?? ""} onChange={(event) => setForm({ ...form, version: event.currentTarget.value })} /></Field><Field label="入口标识"><Input fullWidth value={form.entrypoint ?? ""} onChange={(event) => setForm({ ...form, entrypoint: event.currentTarget.value })} placeholder="vendor.plugin" /></Field></div><Field label="工具 Manifest" hint="HTTP JSON 协议。需包含 endpoint 和 tools；需要人工确认的工具不会自动调用。"><TextArea fullWidth className="min-h-48 font-mono text-sm" value={form.manifestJson ?? ""} onChange={(event) => setForm({ ...form, manifestJson: event.currentTarget.value })} placeholder={'{"endpoint":"https://plugin.example.com/agent-tools","tools":[{"name":"lookup","description":"查询外部数据"}]}'}/></Field></section>; }
function SkillFields({ form, setForm, tools }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>>; tools: PlatformTool[] }) {
  const selected = form.allowedTools ?? [];
  const categoryLabels: Record<string, string> = { app: "应用范围", form: "表单范围", automation: "自动化范围", workflow: "工作流范围", plugin: "插件范围" };
  const toolGroups = Array.from(new Set(tools.map((tool) => tool.category))).map((category) => ({ category, tools: tools.filter((tool) => tool.category === category) }));

  return <section className="space-y-4">
    <section>
      <p className="text-sm font-medium text-[var(--color-text-primary)]">允许工具</p>
      <div className="mt-3 space-y-5">
        {toolGroups.map(({ category, tools: categoryTools }) => <section key={category} aria-label={categoryLabels[category] ?? category}>
          <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-medium text-[var(--color-text-primary)]">{categoryLabels[category] ?? category}</h3><Chip size="sm" variant="soft">{categoryTools.length} 个工具</Chip></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {categoryTools.map((tool) => <Checkbox key={tool.id} isSelected={selected.includes(tool.id)} onChange={(checked) => setForm((current) => ({ ...current, allowedTools: checked ? Array.from(new Set([...(current.allowedTools ?? []), tool.id])) : (current.allowedTools ?? []).filter((id) => id !== tool.id) }))} className="items-start rounded-md border border-[var(--color-border)] p-3">
          <Checkbox.Content className="w-full items-start">
            <Checkbox.Control className="mt-0.5"><Checkbox.Indicator /></Checkbox.Control>
            <span><span className="flex items-center gap-2 text-sm font-medium">{tool.name}<ToolRiskLabel riskLevel={tool.riskLevel} /></span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{tool.description}</span></span>
          </Checkbox.Content>
            </Checkbox>)}
          </div>
        </section>)}
      </div>
      <p className="mt-2 text-xs font-normal text-[var(--color-text-secondary)]">Skill 只能请求此处选中的平台工具。写入和外部工具还会经过 Profile 与运行时策略校验。</p>
    </section>
    <Field label="运行指令" hint="当配置文件绑定此 Skill 时，Agent 会遵循这些指令。"><TextArea fullWidth className="min-h-40 font-mono text-sm" value={form.instructions ?? ""} onChange={(event) => setForm({ ...form, instructions: event.currentTarget.value })} /></Field>
  </section>;
}
function ToolRiskLabel({ riskLevel }: { riskLevel: PlatformTool["riskLevel"] }) { const isRead = riskLevel === "read"; return <span className={isRead ? "rounded bg-[var(--color-success-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-success)]" : riskLevel === "write" ? "rounded bg-[var(--color-warning-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-warning)]" : "rounded bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-danger)]"}>{isRead ? "读取" : riskLevel === "write" ? "写入" : "外部"}</span>; }
function KnowledgeFields({ form, setForm }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>> }) { return <section className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="检索模式"><Select aria-label="检索模式" fullWidth selectedKey="keyword" isDisabled><Select.Trigger><Select.Value>关键词检索</Select.Value><Select.Indicator /></Select.Trigger></Select></Field><Field label="外部数据源 IDs"><Input fullWidth value={(form.sourceIds ?? []).join(", ")} onChange={(event) => setForm({ ...form, sourceIds: split(event.currentTarget.value) })} /></Field></div><Field label="知识内容" hint="当前版本会按关键词检索该内容并提供相关片段给 Agent。"><TextArea fullWidth className="min-h-56 font-mono text-sm" value={form.content ?? ""} onChange={(event) => setForm({ ...form, content: event.currentTarget.value, retrievalMode: "keyword" })} /></Field></section>; }

function split(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
