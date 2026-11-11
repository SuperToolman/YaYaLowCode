"use client";
import { notifyRequestError } from "@/shared/lib/notify";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notify } from "@/shared/lib/notify";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceRobot, Plus, TrashBin, Check, ChevronRight, Globe, Key } from "@gravity-ui/icons";
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
import { Button, Input, ListBox, Modal, SearchField, Select, Tabs } from "@heroui/react";
import { MyTabsListContainer } from "@/shared/ui/MyTabsListContainer";
import { ToggleSetting } from "./ToggleSetting";
import { ProviderConnectionTest } from "./ProviderConnectionTest";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { SettingsContentCard } from "../components/SettingsContentCard";
import { providerPresetsByType, type ProviderPreset, type ProviderType } from "./provider-presets-by-type";
import { createModelRoute, deleteModelRoute, listModelRoutes, updateModelRoute } from "@/features/settings/api";

type AgentModelProvider = {
  id: string;
  providerType: ProviderType;
  name: string;
  kind: string;
  enabled: boolean;
  defaultReasoningEffort: string;
  thinkingEnabled: boolean;
  reasoningProtocol: string;
  isDefault: boolean;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  websiteUrl: string;
  apiKeyConfigured: boolean;
};

const providerTabs: Array<{ id: ProviderType; label: string }> = [
  { id: "chat", label: "对话" },
  { id: "speech_to_text", label: "语音转文字" },
  { id: "text_to_speech", label: "文字转语音" },
  { id: "judgment", label: "判断" },
  { id: "embedding", label: "嵌入（Embedding）" },
  { id: "reranker", label: "重排序" },
];
const providerTypeLabels: Record<ProviderType, string> = Object.fromEntries(
  providerTabs.map(({ id, label }) => [id, label]),
) as Record<ProviderType, string>;
type ProviderForm = Omit<AgentModelProvider, "id" | "apiKeyConfigured">;
const emptyProvider: ProviderForm = {
  name: "OpenAI Compatible",
  providerType: "chat",
  kind: "compatible",
  enabled: true,
  defaultReasoningEffort: "auto",
  thinkingEnabled: false,
  reasoningProtocol: "openai",
  isDefault: false,
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  websiteUrl: "https://platform.openai.com",
};
const allProviderPresets = Object.values(providerPresetsByType).flat();

function ProviderIcon({
  icon,
  name,
  size = 20,
  className,
}: {
  icon?: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const props = { className, size, title: `${name} 图标` };
  switch (icon) {
    case "anthropic":
      return <AnthropicIcon {...props} />;
    case "azure":
      return <AzureIcon {...props} />;
    case "cohere":
      return <CohereIcon {...props} />;
    case "deepseek":
      return <DeepSeekIcon {...props} />;
    case "doubao":
      return <DoubaoIcon {...props} />;
    case "fireworks":
      return <FireworksIcon {...props} />;
    case "google":
      return <GoogleIcon {...props} />;
    case "groq":
      return <GroqIcon {...props} style={{ color: "#F55036" }} />;
    case "minimax":
      return <MinimaxIcon {...props} />;
    case "mistral":
      return <MistralIcon {...props} />;
    case "moonshot":
      return <MoonshotIcon {...props} />;
    case "ollama":
      return <OllamaIcon {...props} />;
    case "openai":
      return <OpenAIIcon {...props} />;
    case "openrouter":
      return <OpenRouterIcon {...props} />;
    case "qwen":
      return <QwenIcon {...props} />;
    case "siliconcloud":
      return <SiliconCloudIcon {...props} />;
    case "together":
      return <TogetherIcon {...props} />;
    case "volcengine":
      return <VolcengineIcon {...props} />;
    case "xai":
      return <XAIIcon {...props} />;
    case "zhipu":
      return <ZhipuIcon {...props} />;
    default:
      return (
        <FaceRobot
          className={className ?? "h-5 w-5"}
          aria-label={`${name} 图标`}
        />
      );
  }
}

function findProviderPreset(provider: Pick<ProviderForm, "name" | "kind">) {
  const normalizedName = provider.name.trim().toLowerCase();
  return (
    allProviderPresets.find(
      (preset) =>
        preset.name.toLowerCase() === normalizedName ||
        preset.id === provider.kind ||
        preset.id === normalizedName.replaceAll(" ", "-"),
    ) ??
    (provider.kind === "deepseek"
      ? allProviderPresets.find((preset) => preset.id === "deepseek")
      : undefined)
  );
}

type ModelRoute = Omit<AgentModelProvider, "kind" | "apiKey" | "websiteUrl">;
type ModelRoutePayload = Omit<ModelRoute, "id" | "apiKeyConfigured"> & {
  apiKey?: string;
};

function ConfigSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-2 rounded-xl">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-subtle)] font-mono text-xs text-[var(--color-text-secondary)]">
          {number}
        </span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
            {description}
          </p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function ConfigField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      {label}
      {children}
      {hint && (
        <span className="text-xs font-normal leading-5 text-[var(--color-text-secondary)]">
          {hint}
        </span>
      )}
    </label>
  );
}

export default function ModelProvidersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.models.manage");
  const [items, setItems] = useState<AgentModelProvider[]>([]);
  const [form, setForm] = useState<ProviderForm>(emptyProvider);
  const [editing, setEditing] = useState<AgentModelProvider | null>(null);
  const createLock = useRef(false);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [presetSearch, setPresetSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deleting, setDeleting] = useState<AgentModelProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState(false);
  const [activeType, setActiveType] = useState<ProviderType>("chat");
  const selectedModel = form.model;
  const validModel = Boolean(selectedModel.trim()) && !/[,，\r\n]/.test(selectedModel);
  const visibleItems = items.filter((item) => item.providerType === activeType);
  const filteredItems = visibleItems.filter((item) =>
    `${item.name} ${item.apiBaseUrl}`
      .toLowerCase()
      .includes(providerSearch.trim().toLowerCase()),
  );
  const hasChanges = Boolean(
    editing &&
    Object.keys(emptyProvider).some((key) => {
      const field = key as keyof ProviderForm;
      return JSON.stringify(form[field]) !== JSON.stringify(editing[field]);
    }),
  );
  const currentTab = providerTabs.find((tab) => tab.id === activeType)!;
  const currentPresets = providerPresetsByType[activeType].filter((preset) =>
    preset.name
      .toLocaleLowerCase()
      .includes(presetSearch.trim().toLocaleLowerCase()),
  );

  const openEdit = useCallback((item: AgentModelProvider) => {
    setEditing(item);
    setForm({ ...item });
  }, []);

  const load = useCallback(
    async (preferredId?: string, type: ProviderType = "chat") => {
      setLoadFailed(false);
      const routes = await listModelRoutes();
      const next = routes.map((route) => ({
        ...emptyProvider,
        ...route,
        providerType: route.providerType as ProviderType,
        thinkingEnabled: route.thinkingEnabled ?? false,
        reasoningProtocol: route.reasoningProtocol ?? "openai",
        kind:
          findProviderPreset({
            name: route.name.replace(/_\d+$/, ""),
            kind: "",
          })?.id ?? "compatible",
        apiKey: "",
        websiteUrl: "",
        apiKeyConfigured: route.apiKeyConfigured,
      }));
      setItems(next);
      const selected =
        next.find((item) => item.id === preferredId) ??
        next.find((item) => item.providerType === type);
      if (selected) openEdit(selected);
      else {
        setEditing(null);
        setForm({ ...emptyProvider, providerType: type });
      }
    },
    [openEdit],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void load()
          .catch((error) => {
            setLoadFailed(true);
            notifyRequestError(error, "无法加载模型提供商", {
              description: String(error),
            });
          })
          .finally(() => setLoading(false)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  function openCreate() {
    setPresetSearch("");
    setPresetPickerOpen(true);
  }
  async function applyPreset(preset: ProviderPreset) {
    if (createLock.current) return;
    createLock.current = true;
    setSaving(true);
    try {
      const created = await createModelRoute({
        name: preset.name,
        providerType: activeType,
        apiBaseUrl: preset.apiBaseUrl,
        enabled: false,
        model: "",
        isDefault: false,
        thinkingEnabled: preset.thinkingEnabled ?? false,
        reasoningProtocol: preset.reasoningProtocol ?? "openai",
        defaultReasoningEffort: preset.defaultReasoningEffort ?? "auto",
      });
      setPresetPickerOpen(false);
      await load(created.id, activeType);
      notify.success("供应商已新增，请完善配置");
    } catch (error) {
      notifyRequestError(error, "无法新增供应商");
    } finally {
      createLock.current = false;
      setSaving(false);
    }
  }
  const effortLabels: Record<string, string> = {
    auto: "自动（使用请求层默认值）",
    low: "低",
    medium: "中",
    high: "高",
    ultra: "超高",
    extreme: "极致",
  };
  const capabilityFields = (value: ProviderForm | AgentModelProvider) => ({
    defaultReasoningEffort: value.defaultReasoningEffort,
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!validModel) {
      notify.error("请输入一个有效的模型 ID", { description: "每条供应商配置只关联一个模型。" });
      return;
    }
    setSaving(true);
    try {
      const payload: ModelRoutePayload = {
        ...capabilityFields(form),
        providerType: form.providerType,
        name: form.name,
        apiBaseUrl: form.apiBaseUrl,
        model: selectedModel.trim(),
        enabled: form.enabled,
        thinkingEnabled: form.providerType === "chat" && form.thinkingEnabled,
        reasoningProtocol: form.reasoningProtocol,
        isDefault: form.providerType === "chat" && form.isDefault,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {}),
      };
      if (editing) await updateModelRoute(editing.id, payload);
      else await createModelRoute(payload);
      notify.success(editing ? "模型提供商已更新" : "模型提供商已创建");
      await load(editing?.id, activeType);
    } catch (error) {
      notifyRequestError(error, "无法保存模型提供商", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingProvider(true);
    try {
      await deleteModelRoute(deleting.id);
      notify.success("模型提供商已删除");
      setDeleting(null);
      await load(undefined, activeType);
    } catch (error) {
      notifyRequestError(error, "无法删除模型提供商", {
        description:
          error instanceof Error
            ? error.message
            : "正在被配置文件使用的提供商无法删除。",
      });
    } finally {
      setDeletingProvider(false);
    }
  }

  return (
    <SettingsContentCard
      title="模型提供商"
      subtitle="管理模型服务连接与默认路由"
      bodyScrollable={false}
      bodyClassName="flex min-w-0 flex-col"
      headerActions={
        <Button
          size="sm"
          isDisabled={
            !canManage || saving || loading || loadFailed || deletingProvider
          }
          onPress={openCreate}
        >
          <Plus className="size-4" />
          添加供应商
        </Button>
      }
    >
      <Tabs
        variant="secondary"
        className="min-w-0 shrink-0"
        selectedKey={activeType}
        isDisabled={saving || deletingProvider || loading}
        onSelectionChange={(key) => {
          const type = key as ProviderType;
          setActiveType(type);
          setProviderSearch("");
          const item = items.find((value) => value.providerType === type);
          if (item) openEdit(item);
          else setEditing(null);
        }}
      >
        <MyTabsListContainer className="max-w-full">
          <Tabs.List aria-label="模型用途">
            {providerTabs.map((tab) => {
              const active = activeType === tab.id;
              const count = items.filter(
                (item) => item.providerType === tab.id,
              ).length;
              return (
                <Tabs.Tab
                  key={tab.id}
                  id={tab.id}
                  className="h-11 w-auto shrink-0 gap-2 whitespace-nowrap"
                >
                  {tab.label}
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-[var(--color-primary-soft)]" : "bg-[var(--color-bg-subtle)]"}`}
                  >
                    {count}
                  </span>
                  <Tabs.Indicator />
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
        </MyTabsListContainer>
      </Tabs>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[210px_minmax(0,1fr)] md:overflow-hidden xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col bg-[var(--color-bg-panel-soft)]/40 p-4 rounded-lg">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
              {currentTab.label}供应商
            </h3>
            <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">
              {visibleItems.length}
            </span>
          </div>
          <SearchField
            aria-label="搜索已添加供应商"
            value={providerSearch}
            onChange={setProviderSearch}
            className="mb-4 w-full"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索供应商" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <nav
            aria-label="已添加供应商"
            className="flex max-h-60 flex-col gap-2 overflow-y-auto md:max-h-none md:flex-1"
          >
            {filteredItems.map((item) => {
              const preset = findProviderPreset(item);
              const active = editing?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  disabled={saving || deletingProvider}
                  onClick={() => openEdit(item)}
                  className={`group flex w-full shrink-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50 ${active ? "border-[var(--color-primary)]/30 bg-[var(--color-bg-surface)] shadow-sm" : "border-transparent hover:bg-[var(--color-bg-hover)]"}`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-bg-surface)]">
                    <ProviderIcon
                      icon={preset?.icon}
                      name={item.name}
                      size={21}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
                      <span
                        className={`size-1.5 rounded-full ${item.enabled ? "bg-[var(--color-success)]" : "bg-[var(--color-text-disabled)]"}`}
                      />
                      {item.enabled ? "已启用" : "未启用"}
                      {item.isDefault && (
                        <span className="text-[var(--color-primary)]">
                          · 默认
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight
                    className={`size-3.5 shrink-0 ${active ? "text-[var(--color-primary)]" : "text-[var(--color-text-disabled)]"}`}
                  />
                </button>
              );
            })}
            {!filteredItems.length && (
              <p className="px-2 py-6 text-center text-xs leading-6 text-[var(--color-text-secondary)]">
                {loading
                  ? "正在加载供应商…"
                  : loadFailed
                    ? "加载失败，请刷新重试"
                    : providerSearch
                      ? "没有匹配的供应商"
                      : "尚未添加供应商"}
              </p>
            )}
          </nav>
        </aside>
        <main
          aria-label="供应商配置"
          className="flex min-w-0 flex-col md:min-h-0"
        >
          {editing ? (
            <form
              onSubmit={save}
              className="flex flex-col md:min-h-0 md:flex-1"
            >
              <div className="pl-2 md:min-h-0 md:flex-1 md:overflow-y-auto lg:pl-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--color-border)]/70 bg-[var(--color-bg-subtle)]">
                      <ProviderIcon
                        icon={findProviderPreset(editing)?.icon}
                        name={editing.name}
                        size={28}
                      />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold">
                        {editing.name}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                        {providerTypeLabels[editing.providerType]} · 供应商配置
                      </p>
                    </div>
                  </div>
                  <span
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${editing.enabled ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {editing.enabled ? "已启用" : "未启用"}
                  </span>
                </div>
                <fieldset
                  disabled={!canManage || saving}
                  className="min-w-0 disabled:opacity-70 flex-col gap-4 py-6 md:flex"
                >
                  <ConfigSection
                    number="01"
                    title="连接配置"
                    description="配置服务地址与访问凭据，连接你的模型供应商。"
                  >
                    <ConfigField label="供应商名称">
                      <Input
                        fullWidth
                        value={form.name}
                        onChange={(event) =>
                          setForm({ ...form, name: event.currentTarget.value })
                        }
                      />
                    </ConfigField>
                    <ConfigField
                      label="API Base URL"
                      hint="填写供应商提供的 API 地址，包含所需的版本路径。"
                    >
                      <div className="relative">
                        <Globe className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                        <Input
                          className="pl-10 font-mono text-xs"
                          fullWidth
                          value={form.apiBaseUrl}
                          placeholder="https://api.example.com/v1"
                          onChange={(event) =>
                            setForm({
                              ...form,
                              apiBaseUrl: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    </ConfigField>
                    <ConfigField
                      label="API Key"
                      hint={
                        editing.apiKeyConfigured
                          ? "已保存密钥。留空将保留现有密钥，填写新密钥可替换。"
                          : "填写供应商的访问密钥；无需认证的本地服务可留空。"
                      }
                    >
                      <div className="relative">
                        <Key className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                        <Input
                          className="pl-10 font-mono text-xs"
                          fullWidth
                          type="password"
                          autoComplete="new-password"
                          placeholder={
                            editing.apiKeyConfigured
                              ? "••••••••••••••••"
                              : "输入 API Key"
                          }
                          value={form.apiKey}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              apiKey: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    </ConfigField>
                  </ConfigSection>
                  <ConfigSection
                    number="02"
                    title="模型配置"
                    description="指定可用的模型 ID，与供应商平台中的模型名称保持一致。"
                  >
                    <ProviderModelPicker
                      key={editing.id}
                      id={editing.id}
                      apiBaseUrl={form.apiBaseUrl}
                      apiKey={form.apiKey}
                      providerKind={form.kind}
                      model={selectedModel}
                      disabled={!canManage || saving}
                      onChange={(model) => setForm((current) => ({
                        ...current,
                        model,
                      }))}
                      label="模型"
                    />
                  </ConfigSection>
                  <ConfigSection
                    number="03"
                    title="运行策略"
                    description="管理供应商的可用状态与模型调用偏好。"
                  >
                    <div className="divide-y divide-[var(--color-border)]/50 rounded-xl border border-[var(--color-border)]/70 px-4">
                      <ToggleSetting
                        title="启用供应商"
                        description="启用后，此供应商可用于模型调用。"
                        selected={form.enabled}
                        disabled={!canManage || saving}
                        onChange={(enabled) => setForm({ ...form, enabled })}
                      />
                      {form.providerType === "chat" && (
                        <ToggleSetting
                          title="设为默认供应商"
                          description="未指定供应商时，优先使用此处配置的默认模型。"
                          selected={form.isDefault}
                          disabled={!canManage || saving || !form.enabled}
                          onChange={(isDefault) =>
                            setForm({ ...form, isDefault })
                          }
                        />
                      )}
                      {form.providerType === "chat" && (
                        <ToggleSetting
                          title="思考模式"
                          description="为支持推理的模型配置思考协议与强度。"
                          selected={form.thinkingEnabled}
                          disabled={!canManage || saving}
                          onChange={(thinkingEnabled) =>
                            setForm({ ...form, thinkingEnabled })
                          }
                        />
                      )}
                    </div>
                    {form.providerType === "chat" && form.thinkingEnabled && (
                      <div className="grid grid-cols-1 gap-4 rounded-xl bg-[var(--color-bg-subtle)]/60 p-4 xl:grid-cols-2">
                        {form.thinkingEnabled && (
                          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
                            思考参数协议
                            <Select
                              aria-label="思考参数协议"
                              selectedKey={form.reasoningProtocol}
                              onSelectionChange={(key) =>
                                key &&
                                setForm({
                                  ...form,
                                  reasoningProtocol: String(key),
                                  defaultReasoningEffort: "auto",
                                })
                              }
                              isDisabled={saving}
                            >
                              <Select.Trigger>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {[
                                    { id: "openai", label: "OpenAI 兼容" },
                                    { id: "deepseek", label: "DeepSeek" },
                                    { id: "qwen", label: "Qwen" },
                                    { id: "openrouter", label: "OpenRouter" },
                                  ].map((item) => (
                                    <ListBox.Item
                                      key={item.id}
                                      id={item.id}
                                      textValue={item.label}
                                    >
                                      {item.label}
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                          </label>
                        )}
                        {form.thinkingEnabled && (
                          <>
                            <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
                              默认思考强度
                              <Select
                                aria-label="默认思考强度"
                                selectedKey={form.defaultReasoningEffort}
                                onSelectionChange={(key) =>
                                  key &&
                                  setForm({
                                    ...form,
                                    defaultReasoningEffort: String(key),
                                  })
                                }
                                isDisabled={saving}
                              >
                                <Select.Trigger>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    {[
                                      "auto",
                                      ...(form.reasoningProtocol === "qwen"
                                        ? []
                                        : form.reasoningProtocol === "deepseek"
                                          ? ["high", "extreme"]
                                          : [
                                              "low",
                                              "medium",
                                              "high",
                                              "ultra",
                                              "extreme",
                                            ]),
                                    ].map((value) => (
                                      <ListBox.Item
                                        key={value}
                                        id={value}
                                        textValue={effortLabels[value]}
                                      >
                                        {effortLabels[value]}
                                      </ListBox.Item>
                                    ))}
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </ConfigSection>
                </fieldset>
              </div>
              <ProviderConnectionTest
                key={editing.id}
                id={editing.id}
                apiBaseUrl={form.apiBaseUrl}
                apiKey={form.apiKey}
                providerKind={form.kind}
                disabled={!canManage || saving || deletingProvider}
                saveStatus={
                  !canManage ? "readonly" : hasChanges ? "unsaved" : "saved"
                }
                deleteAction={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[var(--color-danger)]"
                    isDisabled={!canManage || saving || deletingProvider}
                    onPress={() => setDeleting(editing)}
                  >
                    <TrashBin className="size-4" />
                    删除供应商
                  </Button>
                }
                saveAction={
                  <Button
                    size="sm"
                    type="submit"
                    isDisabled={
                      !canManage ||
                      saving ||
                      !form.name.trim() ||
                      !validModel ||
                      !form.apiBaseUrl.trim()
                    }
                  >
                    <Check className="size-4" />
                    {saving ? "保存中…" : "保存配置"}
                  </Button>
                }
              />
            </form>
          ) : (
            <div className="flex min-h-80 flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <span className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-primary)]">
                <FaceRobot className="size-7" />
              </span>
              <h3 className="text-base font-semibold">
                {loading
                  ? "正在加载模型服务"
                  : loadFailed
                    ? "暂时无法加载模型服务"
                    : visibleItems.length
                      ? "选择一个供应商"
                      : `连接你的${currentTab.label}模型`}
              </h3>
              <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--color-text-secondary)]">
                {loadFailed
                  ? "请刷新页面重试。"
                  : visibleItems.length
                    ? "从左侧选择供应商，查看和编辑连接配置。"
                    : "从供应商预设开始，配置服务地址和模型，即可接入 AI 能力。"}
              </p>
              {!loading && !loadFailed && (
                <Button
                  className="mt-6"
                  size="sm"
                  variant="secondary"
                  isDisabled={!canManage || saving}
                  onPress={openCreate}
                >
                  <Plus className="size-4" />
                  添加供应商
                </Button>
              )}
            </div>
          )}
        </main>
      </div>
      <Modal
        isOpen={presetPickerOpen}
        onOpenChange={(open) => !saving && !open && setPresetPickerOpen(false)}
      >
        <Modal.Backdrop className="theme-modal-backdrop">
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog className="max-h-[82vh] w-[min(820px,calc(100vw-2rem))] min-w-0 max-w-[calc(100vw-2rem)] overflow-hidden">
              <Modal.Header className="flex-row flex-wrap items-center justify-between">
                <Modal.Heading>新建{currentTab.label}供应商</Modal.Heading>
                <div className="flex min-w-0 items-center gap-2">
                  <SearchField
                    aria-label="搜索供应商预设"
                    value={presetSearch}
                    onChange={setPresetSearch}
                    className="min-w-0 w-[min(280px,60vw)]"
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索" />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <Modal.CloseTrigger aria-label="关闭" />
                </div>
              </Modal.Header>
              <Modal.Body className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">供应商</span>
                  <span className="text-[var(--color-text-secondary)]">
                    {currentPresets.length}
                  </span>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {currentPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="secondary"
                      fullWidth
                      className="h-auto min-w-0 justify-start gap-3 rounded-xl p-4 hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary-soft)]"
                      isDisabled={saving}
                      onPress={() => void applyPreset(preset)}
                    >
                      <ProviderIcon
                        icon={preset.icon}
                        name={preset.name}
                        size={32}
                        className="size-8 shrink-0 sm:size-8"
                      />
                      <span
                        className="flex min-w-0 flex-col text-left"
                        title={preset.name}
                      >
                        <span className="truncate text-sm font-medium">
                          {preset.name}
                        </span>
                        <span className="truncate text-[10px] font-normal text-[var(--color-text-secondary)]">
                          {preset.apiBaseUrl || "自定义服务地址"}
                        </span>
                      </span>
                    </Button>
                  ))}
                  {currentPresets.length === 0 && (
                    <p className="col-span-full py-10 text-center text-sm text-[var(--color-text-secondary)]">
                      没有匹配的供应商
                    </p>
                  )}
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => !deletingProvider && !open && setDeleting(null)}
      >
        <Modal.Backdrop
          className="theme-modal-backdrop"
          isDismissable={!deletingProvider}
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>删除供应商</Modal.Heading>
                <Modal.CloseTrigger
                  aria-label="关闭"
                  isDisabled={deletingProvider}
                />
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  确认删除“{deleting?.name}
                  ”吗？正在被配置文件使用的供应商无法删除。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={!canManage || deletingProvider}
                  onPress={() => setDeleting(null)}
                >
                  取消
                </Button>
                <Button
                  isDisabled={!canManage || deletingProvider}
                  className="bg-[var(--color-danger)] text-white"
                  onPress={() => void confirmDelete()}
                >
                  {deletingProvider ? "删除中…" : "删除"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </SettingsContentCard>
  );
}
