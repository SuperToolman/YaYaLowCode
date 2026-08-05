"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { CirclePlay, CircleStop, FaceRobot, Pencil, TrashBin } from "@gravity-ui/icons";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import AzureIcon from "@lobehub/icons/es/Azure/components/Color";
import CohereIcon from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoIcon from "@lobehub/icons/es/Doubao/components/Color";
import FireworksIcon from "@lobehub/icons/es/Fireworks/components/Color";
import GoogleIcon from "@lobehub/icons/es/Google/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MinimaxIcon from "@lobehub/icons/es/Minimax/components/Color";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import OllamaIcon from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Color";
import QwenIcon from "@lobehub/icons/es/Qwen/components/Color";
import SiliconCloudIcon from "@lobehub/icons/es/SiliconCloud/components/Color";
import TogetherIcon from "@lobehub/icons/es/Together/components/Color";
import VolcengineIcon from "@lobehub/icons/es/Volcengine/components/Color";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import ZhipuIcon from "@lobehub/icons/es/Zhipu/components/Color";
import { Button, Input, ListBox, Modal, Select, Switch, Table, Tooltip, toast } from "@heroui/react";
import { createProvider, deleteProvider, listProviders, updateProvider } from "@/features/identity-access/api";
import { SettingsContentCard } from "../_components/settings-content-card";
import type { AgentModelProvider, ApiEnvelope } from "../agent-types";
import providerPresetsJson from "./provider-presets.json";

type ProviderForm = Omit<AgentModelProvider, "id" | "apiKeyConfigured">;
const emptyProvider: ProviderForm = { name: "OpenAI Compatible", kind: "compatible", enabled: true, apiBaseUrl: "https://api.openai.com/v1", apiKey: "", defaultChatModel: "", models: [], websiteUrl: "https://platform.openai.com" };
const legacyProviderKinds = [
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "local", label: "本地模型" },
];
type ProviderPreset = Pick<ProviderForm, "name" | "kind" | "apiBaseUrl" | "websiteUrl"> & { id: string; icon: string };
const providerPresets = providerPresetsJson as ProviderPreset[];
const providerTypeOptions = providerPresets.map((preset) => ({ value: preset.id, label: preset.name, icon: preset.icon }));

function ProviderIcon({ icon, name, size = 20, className }: { icon?: string; name: string; size?: number; className?: string }) {
  const props = { className, size, title: `${name} 图标` };
  switch (icon) {
    case "anthropic": return <AnthropicIcon {...props} style={{ color: "#F1F0E8" }} />;
    case "azure": return <AzureIcon {...props} />;
    case "cohere": return <CohereIcon {...props} />;
    case "deepseek": return <DeepSeekIcon {...props} />;
    case "doubao": return <DoubaoIcon {...props} />;
    case "fireworks": return <FireworksIcon {...props} />;
    case "google": return <GoogleIcon {...props} />;
    case "groq": return <GroqIcon {...props} style={{ color: "#F55036" }} />;
    case "minimax": return <MinimaxIcon {...props} />;
    case "mistral": return <MistralIcon {...props} />;
    case "moonshot": return <MoonshotIcon {...props} style={{ color: "#2B2B2B" }} />;
    case "ollama": return <OllamaIcon {...props} style={{ color: "#FFFFFF" }} />;
    case "openai": return <OpenAIIcon {...props} style={{ color: "#000000" }} />;
    case "openrouter": return <OpenRouterIcon {...props} />;
    case "qwen": return <QwenIcon {...props} />;
    case "siliconcloud": return <SiliconCloudIcon {...props} />;
    case "together": return <TogetherIcon {...props} />;
    case "volcengine": return <VolcengineIcon {...props} />;
    case "xai": return <XAIIcon {...props} style={{ color: "#000000" }} />;
    case "zhipu": return <ZhipuIcon {...props} />;
    default: return <FaceRobot className={className ?? "h-5 w-5"} aria-label={`${name} 图标`} />;
  }
}

function findProviderPreset(provider: Pick<ProviderForm, "name" | "kind">) {
  const normalizedName = provider.name.trim().toLowerCase();
  return providerPresets.find((preset) => preset.name.toLowerCase() === normalizedName || preset.id === provider.kind || preset.id === normalizedName.replaceAll(" ", "-"))
    ?? (provider.kind === "deepseek" ? providerPresets.find((preset) => preset.id === "deepseek") : undefined);
}

function maskApiKey(apiKey: string) {
  if (!apiKey) return "未配置";
  const visibleLength = apiKey.length > 12 ? 4 : 2;
  const maskedLength = Math.max(4, Math.min(12, apiKey.length - visibleLength * 2));
  return `${apiKey.slice(0, visibleLength)}${"*".repeat(maskedLength)}${apiKey.slice(-visibleLength)}`;
}

export default function ModelProvidersPage() {
  const [items, setItems] = useState<AgentModelProvider[]>([]);
  const [form, setForm] = useState<ProviderForm>(emptyProvider);
  const [editing, setEditing] = useState<AgentModelProvider | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AgentModelProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const selectedProviderType = providerTypeOptions.find((item) => item.value === form.kind);

  async function load() {
    const { data, error } = await listProviders({ responseStyle: "fields" });
    const payload = data as ApiEnvelope<AgentModelProvider[]> | undefined;
    if (error || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || "无法加载模型提供商");
    setItems(payload.data);
  }

  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error) => toast.danger("无法加载模型提供商", { description: String(error) })), 0); return () => window.clearTimeout(timer); }, []);

  function openCreate() { setEditing(null); setForm({ ...emptyProvider }); setFormOpen(true); }
  function openEdit(item: AgentModelProvider) { setEditing(item); setForm({ name: item.name, kind: item.kind, enabled: item.enabled, apiBaseUrl: item.apiBaseUrl, apiKey: item.apiKey, defaultChatModel: item.defaultChatModel, models: item.models, websiteUrl: item.websiteUrl }); setFormOpen(true); }
  function applyPreset(preset: ProviderPreset) { setForm((current) => ({ ...current, name: preset.name, kind: preset.id, apiBaseUrl: preset.apiBaseUrl, websiteUrl: preset.websiteUrl })); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = editing
        ? await updateProvider({ path: { id: editing.id }, body: form, responseStyle: "fields" })
        : await createProvider({ body: form, responseStyle: "fields" });
      const payload = result.data as ApiEnvelope<AgentModelProvider> | undefined;
      if (result.error || payload?.code !== 0 || !payload.data) throw new Error(payload?.message || "保存失败");
      toast.success(editing ? "模型提供商已更新" : "模型提供商已创建");
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.danger("无法保存模型提供商", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleProvider(item: AgentModelProvider) {
    try {
      const result = await updateProvider({ path: { id: item.id }, body: { name: item.name, kind: item.kind, enabled: !item.enabled, apiBaseUrl: item.apiBaseUrl, apiKey: item.apiKey, websiteUrl: item.websiteUrl, defaultChatModel: item.defaultChatModel, models: item.models }, responseStyle: "fields" });
      const payload = result.data as ApiEnvelope<AgentModelProvider> | undefined;
      if (result.error || payload?.code !== 0) throw new Error(payload?.message || "更新失败");
      toast.success(item.enabled ? "提供商已停用" : "提供商已启动");
      await load();
    } catch (error) {
      toast.danger("无法更新提供商", { description: error instanceof Error ? error.message : "请稍后重试。" });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingProvider(true);
    try {
      const result = await deleteProvider({ path: { id: deleting.id }, responseStyle: "fields" });
      if (result.error) throw new Error("删除失败");
      toast.success("模型提供商已删除");
      setDeleting(null);
      await load();
    } catch (error) {
      toast.danger("无法删除模型提供商", { description: error instanceof Error ? error.message : "正在被配置文件使用的提供商无法删除。" });
    } finally {
      setDeletingProvider(false);
    }
  }

  return <SettingsContentCard title="模型提供商" subtitle={`管理 Agent 使用的模型服务连接。当前共 ${items.length} 个提供商。`} bodyScrollable={false} headerActions={<Button onPress={openCreate}>新增供应商</Button>}>
    <Table className="h-full min-h-0">
      <Table.ScrollContainer className="h-full overflow-auto">
        <Table.Content aria-label="模型提供商" className="min-w-[1080px] w-full table-fixed">
          <Table.Header>
            <Table.Column id="name" isRowHeader className="w-[18%]">供应商名称</Table.Column>
            <Table.Column id="kind" className="w-[16%]">提供商类型</Table.Column>
            <Table.Column id="base-url" className="w-[22%]">API Base URL</Table.Column>
            <Table.Column id="api-key" className="w-[18%]">API Key</Table.Column>
            <Table.Column id="default-model" className="w-[16%]">默认对话模型</Table.Column>
            <Table.Column id="actions" className="w-[10%]">操作</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">暂无模型提供商，点击“新增供应商”创建连接。</p>}>
            <Table.Collection items={items}>{(item) => {
              const preset = findProviderPreset(item);
              return <Table.Row key={item.id} id={item.id}>
                <Table.Cell><span className="block truncate font-medium">{item.name}</span></Table.Cell>
                <Table.Cell><div className="flex min-w-0 items-center gap-2"><ProviderIcon icon={preset?.icon} name={preset?.name ?? item.name} /><span className="truncate">{preset?.name ?? legacyProviderKinds.find((kind) => kind.value === item.kind)?.label ?? item.kind}</span></div></Table.Cell>
                <Table.Cell><span className="block truncate font-mono text-xs text-[var(--color-text-secondary)]" title={item.apiBaseUrl}>{item.apiBaseUrl}</span></Table.Cell>
                <Table.Cell><span className="font-mono text-xs text-[var(--color-text-secondary)]">{maskApiKey(item.apiKey)}</span></Table.Cell>
                <Table.Cell><span className="block truncate font-mono text-xs text-[var(--color-text-secondary)]" title={item.defaultChatModel}>{item.defaultChatModel || "未设置"}</span></Table.Cell>
                <Table.Cell><div className="flex items-center gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={item.enabled ? `停用 ${item.name}` : `启动 ${item.name}`} onPress={() => void toggleProvider(item)}>{item.enabled ? <CircleStop className="h-4 w-4" /> : <CirclePlay className="h-4 w-4" />}</Button></Tooltip.Trigger><Tooltip.Content>{item.enabled ? "停用" : "启动"}</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`编辑 ${item.name}`} onPress={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>编辑</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`删除 ${item.name}`} className="text-[var(--color-danger)]" onPress={() => setDeleting(item)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>删除</Tooltip.Content></Tooltip></div></Table.Cell>
              </Table.Row>;
            }}</Table.Collection>
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
    <Modal isOpen={formOpen} onOpenChange={(open) => !saving && setFormOpen(open)}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable={!saving}>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="w-[50vw] max-w-[calc(100vw-2rem)] rounded-md bg-[var(--color-bg-surface)]">
            <form onSubmit={save}>
              <Modal.Header><Modal.Heading>{editing ? "编辑供应商" : "新增供应商"}</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={saving} /></Modal.Header>
              <Modal.Body className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">预设供应商</p>
                  <div className="flex flex-wrap gap-2">
                    {providerPresets.map((preset) => <Button key={preset.id} type="button" size="sm" variant="secondary" isDisabled={saving} onPress={() => applyPreset(preset)}>
                      <ProviderIcon icon={preset.icon} name={preset.name} size={16} />{preset.name}
                    </Button>)}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-[var(--color-text-primary)]">供应商名称<Input className="mt-2" fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} disabled={saving} /></label>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)]">提供商类型
                    <Select className="mt-2" aria-label="提供商类型" fullWidth selectedKey={form.kind} onSelectionChange={(key: Key | null) => {
                      const preset = providerPresets.find((item) => item.id === String(key));
                      if (preset) applyPreset(preset);
                    }} isDisabled={saving}>
                      <Select.Trigger><Select.Value><span className="flex min-w-0 items-center gap-2">{selectedProviderType ? <ProviderIcon icon={selectedProviderType.icon} name={selectedProviderType.label} size={16} /> : null}<span className="truncate">{selectedProviderType?.label ?? legacyProviderKinds.find((item) => item.value === form.kind)?.label ?? "请选择"}</span></span></Select.Value><Select.Indicator /></Select.Trigger>
                      <Select.Popover><ListBox>{providerTypeOptions.map((item) => <ListBox.Item key={item.value} id={item.value} textValue={item.label}><div className="flex items-center gap-2"><ProviderIcon icon={item.icon} name={item.label} size={16} />{item.label}</div></ListBox.Item>)}</ListBox></Select.Popover>
                    </Select>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-[var(--color-text-primary)]">API Base URL<Input className="mt-2" fullWidth value={form.apiBaseUrl} onChange={(event) => setForm({ ...form, apiBaseUrl: event.currentTarget.value })} disabled={saving} /></label>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)]">API Key<Input className="mt-2" fullWidth type="text" autoComplete="off" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} disabled={saving} /></label>
                </div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)]">官网链接<Input className="mt-2" fullWidth type="url" value={form.websiteUrl} onChange={(event) => setForm({ ...form, websiteUrl: event.currentTarget.value })} disabled={saving} /></label>
                <label className="block text-sm font-medium text-[var(--color-text-primary)]">默认对话模型<Input className="mt-2" fullWidth value={form.defaultChatModel} placeholder="例如 gpt-4.1" onChange={(event) => setForm({ ...form, defaultChatModel: event.currentTarget.value })} disabled={saving} /></label>
                <Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} isDisabled={saving}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启动供应商</Switch.Content></Switch>
              </Modal.Body>
              <Modal.Footer><Button variant="ghost" isDisabled={saving} onPress={() => setFormOpen(false)}>取消</Button><Button type="submit" isDisabled={saving || !form.name.trim() || !form.apiBaseUrl.trim()}>{saving ? "保存中…" : "保存"}</Button></Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
    <Modal isOpen={Boolean(deleting)} onOpenChange={(open) => !deletingProvider && !open && setDeleting(null)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!deletingProvider}><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>删除供应商</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={deletingProvider} /></Modal.Header><Modal.Body><p className="text-sm text-[var(--color-text-secondary)]">确认删除“{deleting?.name}”吗？正在被配置文件使用的供应商无法删除。</p></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={deletingProvider} onPress={() => setDeleting(null)}>取消</Button><Button isDisabled={deletingProvider} className="bg-[var(--color-danger)] text-white" onPress={() => void confirmDelete()}>{deletingProvider ? "删除中…" : "删除"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </SettingsContentCard>;
}
