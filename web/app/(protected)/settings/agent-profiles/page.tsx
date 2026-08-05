"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Pencil, TrashBin } from "@gravity-ui/icons";
import {
  Button,
  Drawer,
  Input,
  ListBox,
  Modal,
  Select,
  Switch,
  Table,
  Tabs,
  TextArea,
  Tooltip,
} from "@heroui/react";
import { Field } from "../_components/field";
import { SettingsContentCard } from "../_components/settings-content-card";
import type {
  AgentConfigProfile,
  AgentKnowledgeBase,
  AgentModelProvider,
  AgentPersona,
  AgentPlugin,
  AgentSkill,
  ApiEnvelope,
} from "../agent-types";
import { ProviderIcon } from "../model-providers/provider-icon";

type Tab = "ai" | "platform";
type ProfileForm = Omit<
  AgentConfigProfile,
  | "id"
  | "temperature"
  | "maxSteps"
  | "maxRetries"
  | "contextMaxTurns"
  | "contextDiscardTurns"
  | "contextKeepRecentRatio"
  | "maxContextTokens"
  | "allowCreateApps"
  | "allowCreateForms"
  | "allowCreateAutomations"
> & {
  temperature: string;
  maxSteps: string;
  maxRetries: string;
  contextMaxTurns: string;
  contextDiscardTurns: string;
  contextKeepRecentRatio: string;
  maxContextTokens: string;
};

const profileTabs: Array<{ id: Tab; label: string }> = [
  { id: "ai", label: "AI 配置" },
  { id: "platform", label: "平台配置" },
];

const compressionPrompt = `Based on our full conversation history, produce a concise summary of key takeaways and/or project progress.
The primary goal of this summary is to enable seamless continuation of the work that follows.
1. Systematically cover all core topics discussed and the final conclusion/outcome for each; clearly highlight the latest primary focus.
2. If any tools were used, summarize tool usage and extract the most valuable insights from tool outputs.
3. If any materials were read that may be helpful for subsequent work, list them with their scope and path.
4. If there was an initial user goal, state it first and describe the current progress/status.
5. Write the summary in the user's language.`;

function createEmpty(
  providerId = "",
  personaId = "persona-default",
  chatModel = "",
): ProfileForm {
  return {
    name: "新配置文件",
    providerId,
    chatModel,
    embeddingModel: "text-embedding-3-small",
    temperature: "0.2",
    maxSteps: "8",
    maxRetries: "3",
    imageCaptionModel: "",
    personaId,
    webSearchEnabled: false,
    approvalMode: "approve_on_behalf",
    contextMaxTurns: "50",
    contextDiscardTurns: "10",
    contextOverflowStrategy: "llm_compress",
    contextCompressionPrompt: compressionPrompt,
    contextKeepRecentRatio: "0.15",
    contextCompressionProviderId: "",
    maxContextTokens: "128000",
    pluginIds: [],
    skillIds: [],
    knowledgeBaseIds: [],
  };
}

export default function AgentProfilesPage() {
  const [profiles, setProfiles] = useState<AgentConfigProfile[]>([]);
  const [providers, setProviders] = useState<AgentModelProvider[]>([]);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [, setPlugins] = useState<AgentPlugin[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [, setKnowledgeBases] = useState<AgentKnowledgeBase[]>(
    [],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AgentConfigProfile | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const [form, setForm] = useState<ProfileForm>(() => createEmpty());
  const [message, setMessage] = useState("");

  async function load() {
    const responses = await Promise.all(
      [
        "/api/agent/config-profiles",
        "/api/agent/providers",
        "/api/agent/personas",
        "/api/agent/plugins",
        "/api/agent/skills",
        "/api/agent/knowledge-bases",
      ].map((url) => fetch(url, { cache: "no-store" })),
    );
    const [
      profilePayload,
      providerPayload,
      personaPayload,
      pluginPayload,
      skillPayload,
      knowledgePayload,
    ] = (await Promise.all(responses.map((response) => response.json()))) as [
      ApiEnvelope<AgentConfigProfile[]>,
      ApiEnvelope<AgentModelProvider[]>,
      ApiEnvelope<AgentPersona[]>,
      ApiEnvelope<AgentPlugin[]>,
      ApiEnvelope<AgentSkill[]>,
      ApiEnvelope<AgentKnowledgeBase[]>,
    ];
    if (
      !profilePayload.data ||
      !providerPayload.data ||
      !personaPayload.data ||
      !pluginPayload.data ||
      !skillPayload.data ||
      !knowledgePayload.data
    )
      throw new Error("无法加载配置文件资源");
    setProfiles(profilePayload.data);
    setProviders(providerPayload.data);
    setPersonas(personaPayload.data);
    setPlugins(pluginPayload.data);
    setSkills(skillPayload.data);
    setKnowledgeBases(knowledgePayload.data);
  }
  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(String(error))),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  function openCreate() {
    setEditingId(null);
    setTab("ai");
    setMessage("");
    setForm(
      createEmpty(
        providers[0]?.id,
        personas[0]?.id,
        providers[0]?.defaultChatModel,
      ),
    );
    setFormOpen(true);
  }
  function openEdit(item: AgentConfigProfile) {
    setEditingId(item.id);
    setTab("ai");
    setMessage("");
    setForm({
      ...item,
      temperature: String(item.temperature),
      maxSteps: String(item.maxSteps),
      maxRetries: String(item.maxRetries),
      contextMaxTurns: String(item.contextMaxTurns),
      contextDiscardTurns: String(item.contextDiscardTurns),
      contextKeepRecentRatio: String(item.contextKeepRecentRatio),
      maxContextTokens: String(item.maxContextTokens),
    });
    setFormOpen(true);
  }
  async function save() {
    setSaving(true);
    try {
      const response = await fetch(
        editingId
          ? `/api/agent/config-profiles/${encodeURIComponent(editingId)}`
          : "/api/agent/config-profiles",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            temperature: Number(form.temperature),
            maxSteps: Number(form.maxSteps),
            maxRetries: Number(form.maxRetries),
            contextMaxTurns: Number(form.contextMaxTurns),
            contextDiscardTurns: Number(form.contextDiscardTurns),
            contextKeepRecentRatio: Number(form.contextKeepRecentRatio),
            maxContextTokens: Number(form.maxContextTokens),
            contextCompressionProviderId:
              form.contextCompressionProviderId || null,
          }),
        },
      );
      const payload =
        (await response.json()) as ApiEnvelope<AgentConfigProfile>;
      if (!response.ok || !payload.data) {
        setMessage(payload.message);
        return;
      }
      setFormOpen(false);
      setMessage("");
      await load();
    } finally {
      setSaving(false);
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setDeletingProfile(true);
    try {
      const response = await fetch(
        `/api/agent/config-profiles/${encodeURIComponent(deleting.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok) {
        setMessage(payload.message);
        return;
      }
      setDeleting(null);
      await load();
    } finally {
      setDeletingProfile(false);
    }
  }

  return (
    <SettingsContentCard
      title="Agent 配置文件"
      subtitle={`管理模型运行参数、上下文策略与人格选择。能力资源由人格统一编排。当前共 ${profiles.length} 个配置文件。`}
      bodyScrollable={false}
      headerActions={<Button onPress={openCreate}>添加配置文件</Button>}
    >
      <Table className="h-full min-h-0">
        <Table.ScrollContainer className="h-full overflow-auto">
          <Table.Content aria-label="Agent 配置文件" className="min-w-[1080px] w-full table-fixed">
            <Table.Header>
              <Table.Column id="name" isRowHeader className="w-[18%]">配置文件名称</Table.Column>
              <Table.Column id="provider" className="w-[17%]">供应商名称</Table.Column>
              <Table.Column id="model" className="w-[15%]">对话模型</Table.Column>
              <Table.Column id="persona" className="w-[14%]">人格名称</Table.Column>
              <Table.Column id="web-search" className="w-[11%]">联网搜索能力</Table.Column>
              <Table.Column id="resources" className="w-[17%]">人格能力</Table.Column>
              <Table.Column id="actions" className="w-[8%]">操作</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">暂无配置文件，点击“添加配置文件”创建。</p>}>
              <Table.Collection items={profiles}>{(item) => {
                const provider = providers.find(
                  (entry) => entry.id === item.providerId,
                );
                const persona = personas.find(
                  (entry) => entry.id === item.personaId,
                );
                const skillNames = (persona?.skillIds ?? [])
                  .map((id) => skills.find((skill) => skill.id === id)?.name)
                  .filter((name): name is string => Boolean(name));
                const resourceSummary = [
                  skillNames.length ? `${skillNames.length} Skills` : "",
                  persona?.pluginIds?.length ? `${persona.pluginIds.length} 插件` : "",
                  persona?.knowledgeBaseIds?.length ? `${persona.knowledgeBaseIds.length} 知识库` : "",
                ].filter(Boolean);
                return (
                  <Table.Row key={item.id} id={item.id}>
                    <Table.Cell>
                      <span className="block truncate">{item.name}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block truncate text-[var(--color-text-secondary)]">
                        {provider?.name ?? "未选择"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block truncate font-mono text-xs text-[var(--color-text-secondary)]">
                        {item.chatModel ||
                          provider?.defaultChatModel ||
                          "未设置"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="block truncate text-[var(--color-text-secondary)]">
                        {personas.find(
                          (persona) => persona.id === item.personaId,
                        )?.name ?? "未选择"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span
                        className={
                          item.webSearchEnabled
                            ? "text-[var(--color-success)]"
                            : "text-[var(--color-text-secondary)]"
                        }
                      >
                        {item.webSearchEnabled ? "允许" : "拒绝"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap gap-1">
                        {resourceSummary.map((label) => (
                          <span
                            key={label}
                            className="max-w-24 truncate rounded border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]"
                          >
                            {label}
                          </span>
                        ))}
                        {!resourceSummary.length ? <span className="text-xs text-[var(--color-text-secondary)]">未配置</span> : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`编辑 ${item.name}`}
                              onPress={() => openEdit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>编辑</Tooltip.Content>
                        </Tooltip>
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`删除 ${item.name}`}
                              className="text-[var(--color-danger)]"
                              onPress={() => setDeleting(item)}
                            >
                              <TrashBin className="h-4 w-4" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>删除</Tooltip.Content>
                        </Tooltip>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              }}</Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <Drawer
        isOpen={formOpen}
        onOpenChange={(open) => !saving && setFormOpen(open)}
      >
        <Drawer.Backdrop
          className="theme-modal-backdrop"
          isDismissable={!saving}
        >
          <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-[100dvh] w-[min(960px,80vw)] max-w-[96vw] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <form
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <Drawer.Header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
                  <Drawer.Heading>
                    {editingId ? "编辑配置文件" : "添加配置文件"}
                  </Drawer.Heading>
                  <Drawer.CloseTrigger aria-label="关闭" isDisabled={saving} />
                </Drawer.Header>
                <Drawer.Body className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                  <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                    配置文件名称
                    <Input
                      className="mt-2"
                      fullWidth
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.currentTarget.value })
                      }
                      disabled={saving}
                    />
                  </label>
                  <Tabs
                    variant="secondary"
                    selectedKey={tab}
                    onSelectionChange={(key) => setTab(key as Tab)}
                  >
                    <Tabs.ListContainer className="overflow-x-auto">
                      <Tabs.List
                        aria-label="配置文件设置"
                        className="min-w-max"
                      >
                        {profileTabs.map((item) => (
                          <Tabs.Tab
                            key={item.id}
                            id={item.id}
                            className="px-3 py-2 text-xs font-medium"
                          >
                            {item.label}
                            <Tabs.Indicator />
                          </Tabs.Tab>
                        ))}
                      </Tabs.List>
                    </Tabs.ListContainer>
                    <Tabs.Panel id="ai" className="pt-4 outline-none">
                      <AiConfig
                        form={form}
                        setForm={setForm}
                        providers={providers}
                        personas={personas}
                      />
                    </Tabs.Panel>
                    <Tabs.Panel id="platform" className="pt-4 outline-none">
                      <PlatformConfig form={form} setForm={setForm} />
                    </Tabs.Panel>
                  </Tabs>
                  {message ? (
                    <p className="rounded-md bg-[var(--color-bg-subtle)] p-3 text-sm">
                      {message}
                    </p>
                  ) : null}
                </Drawer.Body>
                <Drawer.Footer className="shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
                  <Button
                    variant="ghost"
                    isDisabled={saving}
                    onPress={() => setFormOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    isDisabled={saving || !form.name.trim() || !form.providerId}
                  >
                    {saving ? "保存中…" : "保存"}
                  </Button>
                </Drawer.Footer>
              </form>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
      <Modal
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => !deletingProfile && !open && setDeleting(null)}
      >
        <Modal.Backdrop
          className="theme-modal-backdrop"
          isDismissable={!deletingProfile}
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>删除配置文件</Modal.Heading>
                <Modal.CloseTrigger
                  aria-label="关闭"
                  isDisabled={deletingProfile}
                />
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  确认删除“{deleting?.name}”吗？被 Agent
                  使用的配置文件无法删除。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={deletingProfile}
                  onPress={() => setDeleting(null)}
                >
                  取消
                </Button>
                <Button
                  isDisabled={deletingProfile}
                  className="bg-[var(--color-danger)] text-white"
                  onPress={() => void confirmDelete()}
                >
                  {deletingProfile ? "删除中…" : "删除"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </SettingsContentCard>
  );
}

function LegacyAgentProfilesPage() {
  const [profiles, setProfiles] = useState<AgentConfigProfile[]>([]);
  const [providers, setProviders] = useState<AgentModelProvider[]>([]);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [, setPlugins] = useState<AgentPlugin[]>([]);
  const [, setSkills] = useState<AgentSkill[]>([]);
  const [, setKnowledgeBases] = useState<AgentKnowledgeBase[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ai");
  const [form, setForm] = useState<ProfileForm>(() => createEmpty());
  const [message, setMessage] = useState("");

  async function load(preferredId = selectedId) {
    const responses = await Promise.all(
      [
        "/api/agent/config-profiles",
        "/api/agent/providers",
        "/api/agent/personas",
        "/api/agent/plugins",
        "/api/agent/skills",
        "/api/agent/knowledge-bases",
      ].map((url) => fetch(url, { cache: "no-store" })),
    );
    const [
      profilePayload,
      providerPayload,
      personaPayload,
      pluginPayload,
      skillPayload,
      knowledgePayload,
    ] = (await Promise.all(responses.map((response) => response.json()))) as [
      ApiEnvelope<AgentConfigProfile[]>,
      ApiEnvelope<AgentModelProvider[]>,
      ApiEnvelope<AgentPersona[]>,
      ApiEnvelope<AgentPlugin[]>,
      ApiEnvelope<AgentSkill[]>,
      ApiEnvelope<AgentKnowledgeBase[]>,
    ];
    if (
      !profilePayload.data ||
      !providerPayload.data ||
      !personaPayload.data ||
      !pluginPayload.data ||
      !skillPayload.data ||
      !knowledgePayload.data
    )
      throw new Error("无法加载配置文件资源");
    setProfiles(profilePayload.data);
    setProviders(providerPayload.data);
    setPersonas(personaPayload.data);
    setPlugins(pluginPayload.data);
    setSkills(skillPayload.data);
    setKnowledgeBases(knowledgePayload.data);
    const current =
      profilePayload.data.find((item) => item.id === preferredId) ??
      profilePayload.data[0];
    if (current) selectProfile(current);
    else
      setForm(
        createEmpty(
          providerPayload.data[0]?.id,
          personaPayload.data[0]?.id,
          providerPayload.data[0]?.defaultChatModel,
        ),
      );
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setMessage(String(error)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectProfile(item: AgentConfigProfile) {
    setSelectedId(item.id);
    setTab("ai");
    setForm({
      ...item,
      temperature: String(item.temperature),
      maxSteps: String(item.maxSteps),
      maxRetries: String(item.maxRetries),
      contextMaxTurns: String(item.contextMaxTurns),
      contextDiscardTurns: String(item.contextDiscardTurns),
      contextKeepRecentRatio: String(item.contextKeepRecentRatio),
      maxContextTokens: String(item.maxContextTokens),
    });
  }
  function startCreate() {
    setSelectedId(null);
    setTab("ai");
    setMessage("");
    setForm(
      createEmpty(
        providers[0]?.id,
        personas[0]?.id,
        providers[0]?.defaultChatModel,
      ),
    );
  }

  async function save() {
    const response = await fetch(
      selectedId
        ? `/api/agent/config-profiles/${encodeURIComponent(selectedId)}`
        : "/api/agent/config-profiles",
      {
        method: selectedId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          temperature: Number(form.temperature),
          maxSteps: Number(form.maxSteps),
          maxRetries: Number(form.maxRetries),
          contextMaxTurns: Number(form.contextMaxTurns),
          contextDiscardTurns: Number(form.contextDiscardTurns),
          contextKeepRecentRatio: Number(form.contextKeepRecentRatio),
          maxContextTokens: Number(form.maxContextTokens),
          contextCompressionProviderId:
            form.contextCompressionProviderId || null,
        }),
      },
    );
    const payload = (await response.json()) as ApiEnvelope<AgentConfigProfile>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setSelectedId(payload.data.id);
    setMessage("配置文件已保存");
    await load(payload.data.id);
  }
  async function remove() {
    if (!selectedId) return;
    const response = await fetch(
      `/api/agent/config-profiles/${encodeURIComponent(selectedId)}`,
      { method: "DELETE" },
    );
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    if (!response.ok) return setMessage(payload.message);
    setSelectedId(null);
    setMessage("配置文件已删除");
    await load(null);
  }

  return (
    <SettingsContentCard
      title="Agent 配置文件"
      subtitle={`管理模型运行参数、上下文策略与人格选择。能力资源由人格统一编排。当前共 ${profiles.length} 个配置文件。`}
      bodyScrollable={false}
      headerActions={<Button onPress={startCreate}>添加配置文件</Button>}
      footer={
        <>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {selectedId ? "正在编辑已有配置文件" : "正在创建新配置文件"}
          </p>
          <div className="flex gap-2">
            {selectedId ? (
              <Button
                variant="ghost"
                className="text-[var(--color-danger)]"
                onPress={() => void remove()}
              >
                删除
              </Button>
            ) : null}
            <Button onPress={() => void save()}>保存配置</Button>
          </div>
        </>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[160px_minmax(0,1fr)] overflow-clip rounded-lg border border-[var(--color-border)] lg:grid-cols-[210px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="flex min-h-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-2 lg:border-b-0 lg:border-r">
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {profiles.map((item) => (
              <Button
                key={item.id}
                fullWidth
                variant="ghost"
                onPress={() => selectProfile(item)}
                className={`h-auto min-h-0 justify-start rounded-md px-3 py-2.5 text-left ${selectedId === item.id ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-secondary)]">
                    {providers.find(
                      (provider) => provider.id === item.providerId,
                    )?.name ?? "未选择模型提供商"}
                  </span>
                </span>
              </Button>
            ))}
          </nav>
        </aside>

        <Tabs
          variant="secondary"
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as Tab)}
          className="flex min-h-0 flex-col overflow-clip bg-[var(--color-bg-surface)]"
        >
          <header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
            <div className="min-w-0 max-w-xl">
              <Input
                aria-label="配置文件名称"
                fullWidth
                className="max-w-md text-lg font-semibold"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.currentTarget.value })
                }
              />
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {selectedId ? "编辑配置文件" : "正在创建新配置文件"}
              </p>
            </div>
            <Tabs.ListContainer className="mt-4 overflow-x-auto">
              <Tabs.List aria-label="配置文件设置" className="min-w-max">
                {profileTabs.map((item) => (
                  <Tabs.Tab
                    key={item.id}
                    id={item.id}
                    className="px-3 py-2 text-xs font-medium"
                  >
                    {item.label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <Tabs.Panel id="ai" className="outline-none">
              <AiConfig
                form={form}
                setForm={setForm}
                providers={providers}
                personas={personas}
              />
            </Tabs.Panel>
            <Tabs.Panel id="platform" className="outline-none">
              <PlatformConfig form={form} setForm={setForm} />
            </Tabs.Panel>
            {message ? (
              <p className="mt-4 rounded-lg bg-[var(--color-bg-subtle)] p-3 text-sm">
                {message}
              </p>
            ) : null}
          </div>
        </Tabs>
      </div>
    </SettingsContentCard>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function AiConfig({
  form,
  setForm,
  providers,
  personas,
}: {
  form: ProfileForm;
  setForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
  providers: AgentModelProvider[];
  personas: AgentPersona[];
}) {
  const providerOptions = providers.map((item) => ({
    value: item.id,
    label: item.name,
    icon: item.kind,
  }));
  const selectedProvider = providers.find(
    (provider) => provider.id === form.providerId,
  );
  const defaultChatModel = selectedProvider?.defaultChatModel ?? "";
  const chatModelOptions = [
    ...(defaultChatModel
      ? [{ value: defaultChatModel, label: `默认模型 (${defaultChatModel})` }]
      : []),
    ...(selectedProvider?.models ?? [])
      .filter((model) => model !== defaultChatModel)
      .map((model) => ({ value: model, label: model })),
  ];
  const personaOptions = personas.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  return (
    <>
      <Section title="模型">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="模型提供商">
            <SettingSelect
              ariaLabel="模型提供商"
              value={form.providerId}
              options={providerOptions}
              onChange={(providerId) => {
                const provider = providers.find(
                  (item) => item.id === providerId,
                );
                setForm({
                  ...form,
                  providerId,
                  chatModel: provider?.defaultChatModel ?? "",
                });
              }}
            />
          </Field>
          <Field label="请求最大重试次数">
            <Input
              fullWidth
              type="number"
              min="0"
              max="20"
              value={form.maxRetries}
              onChange={(event) =>
                setForm({ ...form, maxRetries: event.currentTarget.value })
              }
            />
          </Field>
          <Field label="对话模型">
            <SettingSelect
              ariaLabel="对话模型"
              value={form.chatModel}
              options={chatModelOptions}
              onChange={(chatModel) => setForm({ ...form, chatModel })}
            />
          </Field>
          <Field label="Embedding 模型">
            <Input
              fullWidth
              value={form.embeddingModel}
              onChange={(event) =>
                setForm({ ...form, embeddingModel: event.currentTarget.value })
              }
            />
          </Field>
          <Field label="默认图片转述模型">
            <Input
              fullWidth
              value={form.imageCaptionModel}
              onChange={(event) =>
                setForm({
                  ...form,
                  imageCaptionModel: event.currentTarget.value,
                })
              }
              placeholder="留空则使用当前对话模型"
            />
          </Field>
        </div>
      </Section>
      <Section title="人格">
        <Field label="选择人格">
          <SettingSelect
            ariaLabel="选择人格"
            value={form.personaId}
            options={personaOptions}
            onChange={(personaId) => setForm({ ...form, personaId })}
          />
        </Field>
      </Section>
      <Section title="联网搜索能力">
        <Switch
          isSelected={form.webSearchEnabled}
          onChange={(webSearchEnabled) =>
            setForm({ ...form, webSearchEnabled })
          }
        >
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            允许 Agent 使用联网搜索能力
          </Switch.Content>
        </Switch>
      </Section>
      <Section
        title="上下文管理策略"
        description="控制普通会话历史截断、LLM 压缩及上下文窗口兜底行为。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="压缩前最多保留对话轮数" hint="-1 表示不按轮数限制。">
            <Input
              fullWidth
              type="number"
              min="-1"
              value={form.contextMaxTurns}
              onChange={(event) =>
                setForm({ ...form, contextMaxTurns: event.currentTarget.value })
              }
            />
          </Field>
          <Field label="轮次超限时一次丢弃轮数">
            <Input
              fullWidth
              type="number"
              min="1"
              value={form.contextDiscardTurns}
              onChange={(event) =>
                setForm({
                  ...form,
                  contextDiscardTurns: event.currentTarget.value,
                })
              }
            />
          </Field>
          <Field label="历史超限时处理方式">
            <SettingSelect
              ariaLabel="历史超限时处理方式"
              value={form.contextOverflowStrategy}
              options={[
                { value: "llm_compress", label: "由 LLM 压缩上下文" },
                { value: "truncate", label: "按对话轮数截断" },
              ]}
              onChange={(contextOverflowStrategy) =>
                setForm({ ...form, contextOverflowStrategy })
              }
            />
          </Field>
          <Field label="压缩时保留最近上下文比例" hint="范围 0–0.3。">
            <Input
              fullWidth
              type="number"
              min="0"
              max="0.3"
              step="0.01"
              value={form.contextKeepRecentRatio}
              onChange={(event) =>
                setForm({
                  ...form,
                  contextKeepRecentRatio: event.currentTarget.value,
                })
              }
            />
          </Field>
          <Field
            label="用于上下文压缩的模型提供商 ID"
            hint="留空使用当前聊天模型。"
          >
            <SettingSelect
              ariaLabel="上下文压缩模型提供商"
              value={form.contextCompressionProviderId ?? ""}
              options={[{ value: "", label: "未选择" }, ...providerOptions]}
              onChange={(contextCompressionProviderId) =>
                setForm({ ...form, contextCompressionProviderId })
              }
            />
          </Field>
          <Field label="上下文窗口兜底值">
            <Input
              fullWidth
              type="number"
              min="0"
              value={form.maxContextTokens}
              onChange={(event) =>
                setForm({
                  ...form,
                  maxContextTokens: event.currentTarget.value,
                })
              }
            />
          </Field>
        </div>
        <Field label="上下文压缩提示词" hint="为空时由后端使用默认提示词。">
          <TextArea
            fullWidth
            className="min-h-44 font-mono text-xs leading-5"
            value={form.contextCompressionPrompt}
            onChange={(event) =>
              setForm({
                ...form,
                contextCompressionPrompt: event.currentTarget.value,
              })
            }
          />
        </Field>
      </Section>
    </>
  );
}

function PlatformConfig({
  form,
  setForm,
}: {
  form: ProfileForm;
  setForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
}) {
  return (
    <>
      <Section title="执行参数">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Temperature">
            <Input
              fullWidth
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature}
              onChange={(event) =>
                setForm({ ...form, temperature: event.currentTarget.value })
              }
            />
          </Field>
          <Field label="最大执行步骤">
            <Input
              fullWidth
              type="number"
              min="1"
              max="30"
              value={form.maxSteps}
              onChange={(event) =>
                setForm({ ...form, maxSteps: event.currentTarget.value })
              }
            />
          </Field>
        </div>
      </Section>
      <Section
        title="批准操作"
        description="所有模式仍受当前用户 RBAC、应用范围和审计记录约束。"
      >
        <Field label="写操作批准策略">
          <SettingSelect
            ariaLabel="写操作批准策略"
            value={form.approvalMode}
            options={[
              {
                value: "request_approval",
                label: "请求批准 - 每次写入均需确认",
              },
              {
                value: "approve_on_behalf",
                label: "替我审批 - 自动执行草稿类写入",
              },
              {
                value: "full_access",
                label: "完全访问 - 允许已授权写操作直接执行",
              },
            ]}
            onChange={(approvalMode) =>
              setForm({
                ...form,
                approvalMode: approvalMode as ProfileForm["approvalMode"],
              })
            }
          />
        </Field>
      </Section>
    </>
  );
}

function SettingSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: Array<{ value: string; label: string; icon?: string }>;
  onChange: (value: string) => void;
}) {
  const selectedOption = options.find((item) => item.value === value);
  const selectedLabel = selectedOption?.label ?? "请选择";
  const selectedKey =
    value || (options.some((item) => item.value === "") ? "__empty__" : null);
  return (
    <Select
      aria-label={ariaLabel}
      fullWidth
      selectedKey={selectedKey}
      onSelectionChange={(key: Key | null) =>
        onChange(key === null || key === "__empty__" ? "" : String(key))
      }
    >
      <Select.Trigger>
        <Select.Value>
          <span className="flex min-w-0 items-center gap-2">
            {selectedOption?.icon ? (
              <ProviderIcon
                icon={selectedOption.icon}
                name={selectedOption.label}
                size={16}
              />
            ) : null}
            <span className="truncate">{selectedLabel}</span>
          </span>
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((item) => (
            <ListBox.Item
              key={item.value || "__empty__"}
              id={item.value || "__empty__"}
              textValue={item.label}
            >
              <span className="flex items-center gap-2">
                {item.icon ? (
                  <ProviderIcon icon={item.icon} name={item.label} size={16} />
                ) : null}
                {item.label}
              </span>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
