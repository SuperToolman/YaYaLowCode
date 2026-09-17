"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, TrashBin } from "@gravity-ui/icons";
import { Button, Chip, Drawer, Input, Modal, Select, Switch, Table, TextArea, Tooltip, toast } from "@heroui/react";
import { Field } from "./Field";
import { SettingsContentCard } from "./SettingsContentCard";
import { deleteAgentResource, listAgentResources, saveAgentResource, type AgentResourceKind } from "@features/agent-resources/api";

type Kind = AgentResourceKind;
type Resource = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  version?: string;
  entrypoint?: string;
  manifestJson?: string;
  requiresConfirmation?: boolean;
  retrievalMode?: string;
  content?: string;
  sourceIds?: string[];
};

const meta = {
  plugin: {
    title: "插件",
    description: "管理 AI 员工可以使用的外部扩展能力。",
    createLabel: "新增插件",
  },
  knowledge: {
    title: "知识库",
    description: "管理 AI 员工可以检索的业务资料。",
    createLabel: "新增知识库",
  },
} as const;

function empty(kind: Kind): Omit<Resource, "id"> {
  return {
    name: "",
    description: "",
    enabled: true,
    version: kind === "plugin" ? "0.1.0" : undefined,
    entrypoint: "",
    manifestJson: "",
    requiresConfirmation: kind === "plugin" ? false : undefined,
    retrievalMode: kind === "knowledge" ? "keyword" : undefined,
    content: "",
    sourceIds: [],
  };
}

export function AgentResourcePage({ kind }: { kind: Kind }) {
  const config = meta[kind];
  const [items, setItems] = useState<Resource[]>([]);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Resource, "id">>(() => empty(kind));
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingResource, setDeletingResource] = useState(false);

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return items;
    return items.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(keyword));
  }, [items, query]);

  async function load() {
    setItems(await listAgentResources<Resource[]>(kind));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => toast.danger(`无法加载${config.title}`, {
        description: error instanceof Error ? error.message : String(error),
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    setEditingId(null);
    setForm(empty(kind));
    setEditorOpen(true);
  }

  function openEdit(item: Resource) {
    const { id, ...value } = item;
    setEditingId(id);
    setForm(value);
    setEditorOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = kind === "knowledge" ? { ...form, retrievalMode: "keyword" } : form;
      await saveAgentResource<Resource>(kind, editingId, body);
      toast.success(`${config.title}已保存`);
      setEditorOpen(false);
      await load();
    } catch (error) {
      toast.danger(`${config.title}保存失败`, {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingResource(true);
    try {
      await deleteAgentResource<unknown>(kind, deleting.id);
      toast.success(`${config.title}已删除`);
      setDeleting(null);
      await load();
    } catch (error) {
      toast.danger(`${config.title}删除失败`, {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setDeletingResource(false);
    }
  }

  return (
    <SettingsContentCard
      title={config.title}
      subtitle={config.description}
      bodyScrollable={false}
      headerActions={(
        <>
          <Input aria-label={`搜索${config.title}`} className="w-full sm:w-72" placeholder="搜索名称或说明" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <Button onPress={openCreate}>{config.createLabel}</Button>
        </>
      )}
    >
      <Table className="h-full min-h-0">
        <Table.ScrollContainer className="h-full overflow-auto">
          <Table.Content aria-label={config.title} className="min-w-[880px] w-full table-fixed">
            <Table.Header>
              <Table.Column id="name" isRowHeader className="w-[22%]">名称</Table.Column>
              <Table.Column id="description" className="w-[28%]">说明</Table.Column>
              <Table.Column id="configuration" className="w-[28%]">配置</Table.Column>
              <Table.Column id="status" className="w-[10%]">状态</Table.Column>
              <Table.Column id="actions" className="w-[12%]">操作</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">{items.length ? "没有匹配结果" : `暂无${config.title}`}</p>}>
              <Table.Collection items={visibleItems}>{(item) => (
                <Table.Row key={item.id} id={item.id}>
                  <Table.Cell><span className="block truncate font-medium">{item.name}</span></Table.Cell>
                  <Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{item.description || "暂无说明"}</span></Table.Cell>
                  <Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{resourceSummary(item, kind)}</span></Table.Cell>
                  <Table.Cell><Chip size="sm" color={item.enabled ? "success" : "danger"} variant="soft">{item.enabled ? "已启用" : "已停用"}</Chip></Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑</Tooltip.Content></Tooltip>
                      <Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`删除 ${item.name}`} onPress={() => setDeleting(item)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip>
                    </div>
                  </Table.Cell>
                </Table.Row>
              )}</Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Drawer isOpen={editorOpen} onOpenChange={(open) => !saving && setEditorOpen(open)}>
        <Drawer.Backdrop isDismissable={!saving}>
          <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-[100dvh] w-[min(760px,96vw)] max-w-[96vw] flex-col overflow-hidden">
              <form className="flex min-h-0 flex-1 flex-col" onSubmit={save}>
                <Drawer.Header><Drawer.Heading>{editingId ? `编辑${config.title}` : config.createLabel}</Drawer.Heading><Drawer.CloseTrigger aria-label="关闭" isDisabled={saving} /></Drawer.Header>
                <Drawer.Body className="min-h-0 flex-1 space-y-5 overflow-y-auto">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="名称"><Input autoFocus fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field>
                    <Field label="说明"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field>
                  </div>
                  {kind === "plugin" ? <PluginFields form={form} setForm={setForm} /> : <KnowledgeFields form={form} setForm={setForm} />}
                  <div className="border-t border-[var(--color-border)] pt-5">
                    <Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用{config.title}</Switch.Content></Switch>
                  </div>
                </Drawer.Body>
                <Drawer.Footer><Button type="button" variant="ghost" isDisabled={saving} onPress={() => setEditorOpen(false)}>取消</Button><Button type="submit" isPending={saving} isDisabled={saving || !form.name.trim()}>保存</Button></Drawer.Footer>
              </form>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Modal isOpen={Boolean(deleting)} onOpenChange={(open) => !deletingResource && !open && setDeleting(null)}>
        <Modal.Backdrop isDismissable={!deletingResource}>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog>
              <Modal.Header><Modal.Heading>删除{config.title}</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={deletingResource} /></Modal.Header>
              <Modal.Body><p className="text-sm text-[var(--color-text-secondary)]">确认删除“{deleting?.name}”吗？已被 AI 员工引用的资源无法删除。</p></Modal.Body>
              <Modal.Footer><Button variant="ghost" isDisabled={deletingResource} onPress={() => setDeleting(null)}>取消</Button><Button variant="danger" isPending={deletingResource} onPress={() => void confirmDelete()}>删除</Button></Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </SettingsContentCard>
  );
}

function resourceSummary(item: Resource, kind: Kind) {
  if (kind === "knowledge") {
    return `${item.content?.trim().length ?? 0} 字符内容${item.sourceIds?.length ? ` · ${item.sourceIds.length} 个外部来源` : ""}`;
  }
  return `${item.version || "未设置版本"}${item.entrypoint ? ` · ${item.entrypoint}` : " · 未设置入口"}`;
}

function PluginFields({ form, setForm }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>> }) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="版本"><Input fullWidth value={form.version ?? ""} onChange={(event) => setForm({ ...form, version: event.currentTarget.value })} /></Field>
        <Field label="入口标识"><Input fullWidth value={form.entrypoint ?? ""} onChange={(event) => setForm({ ...form, entrypoint: event.currentTarget.value })} placeholder="vendor.plugin" /></Field>
      </div>
      <Field label="工具 Manifest" hint="HTTP JSON 协议，需包含 endpoint 和 tools。"><TextArea fullWidth className="min-h-48 font-mono text-sm" value={form.manifestJson ?? ""} onChange={(event) => setForm({ ...form, manifestJson: event.currentTarget.value })} placeholder={'{"endpoint":"https://plugin.example.com/agent-tools","tools":[{"name":"lookup","description":"查询外部数据"}]}'}/></Field>
      <Switch isSelected={Boolean(form.requiresConfirmation)} onChange={(requiresConfirmation) => setForm({ ...form, requiresConfirmation })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>执行前需确认</Switch.Content></Switch>
    </section>
  );
}

function KnowledgeFields({ form, setForm }: { form: Omit<Resource, "id">; setForm: React.Dispatch<React.SetStateAction<Omit<Resource, "id">>> }) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="检索模式"><Select aria-label="检索模式" fullWidth selectedKey="keyword" isDisabled><Select.Trigger><Select.Value>关键词检索</Select.Value><Select.Indicator /></Select.Trigger></Select></Field>
        <Field label="外部数据源 IDs"><Input fullWidth value={(form.sourceIds ?? []).join(", ")} onChange={(event) => setForm({ ...form, sourceIds: split(event.currentTarget.value) })} /></Field>
      </div>
      <Field label="知识内容" hint="内容会按关键词检索并提供相关片段给 AI 员工。"><TextArea fullWidth className="min-h-56 font-mono text-sm" value={form.content ?? ""} onChange={(event) => setForm({ ...form, content: event.currentTarget.value, retrievalMode: "keyword" })} /></Field>
    </section>
  );
}

function split(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
