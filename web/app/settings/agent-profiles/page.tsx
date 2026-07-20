"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Button, Checkbox, Input, ListBox, Select, Switch, Tabs, TextArea } from "@heroui/react";
import { Field } from "../_components/field";
import type { AgentConfigProfile, AgentKnowledgeBase, AgentModelProvider, AgentPersona, AgentPlugin, AgentSkill, ApiEnvelope } from "../agent-types";

type Tab = "ai" | "platform" | "plugins" | "skills";
type ProfileForm = Omit<AgentConfigProfile, "id" | "temperature" | "maxSteps" | "maxRetries" | "contextMaxTurns" | "contextDiscardTurns" | "contextKeepRecentRatio" | "maxContextTokens"> & { temperature: string; maxSteps: string; maxRetries: string; contextMaxTurns: string; contextDiscardTurns: string; contextKeepRecentRatio: string; maxContextTokens: string };

const profileTabs: Array<{ id: Tab; label: string }> = [
  { id: "ai", label: "AI 配置" },
  { id: "platform", label: "平台配置" },
  { id: "plugins", label: "插件配置" },
  { id: "skills", label: "SKILL 配置" },
];

const compressionPrompt = `Based on our full conversation history, produce a concise summary of key takeaways and/or project progress.
The primary goal of this summary is to enable seamless continuation of the work that follows.
1. Systematically cover all core topics discussed and the final conclusion/outcome for each; clearly highlight the latest primary focus.
2. If any tools were used, summarize tool usage and extract the most valuable insights from tool outputs.
3. If any materials were read that may be helpful for subsequent work, list them with their scope and path.
4. If there was an initial user goal, state it first and describe the current progress/status.
5. Write the summary in the user's language.`;

function createEmpty(providerId = "", personaId = "persona-default"): ProfileForm {
  return { name: "新配置文件", providerId, chatModel: "gpt-4.1-mini", embeddingModel: "text-embedding-3-small", temperature: "0.2", maxSteps: "8", maxRetries: "3", imageCaptionModel: "", personaId, webSearchEnabled: false, contextMaxTurns: "50", contextDiscardTurns: "10", contextOverflowStrategy: "llm_compress", contextCompressionPrompt: compressionPrompt, contextKeepRecentRatio: "0.15", contextCompressionProviderId: "", maxContextTokens: "128000", pluginIds: [], skillIds: [], knowledgeBaseIds: [] };
}

export default function AgentProfilesPage() {
  const [profiles, setProfiles] = useState<AgentConfigProfile[]>([]);
  const [providers, setProviders] = useState<AgentModelProvider[]>([]);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<AgentKnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ai");
  const [form, setForm] = useState<ProfileForm>(() => createEmpty());
  const [message, setMessage] = useState("");

  async function load(preferredId = selectedId) {
    const responses = await Promise.all(["/api/agent/config-profiles", "/api/agent/providers", "/api/agent/personas", "/api/agent/plugins", "/api/agent/skills", "/api/agent/knowledge-bases"].map((url) => fetch(url, { cache: "no-store" })));
    const [profilePayload, providerPayload, personaPayload, pluginPayload, skillPayload, knowledgePayload] = await Promise.all(responses.map((response) => response.json())) as [ApiEnvelope<AgentConfigProfile[]>, ApiEnvelope<AgentModelProvider[]>, ApiEnvelope<AgentPersona[]>, ApiEnvelope<AgentPlugin[]>, ApiEnvelope<AgentSkill[]>, ApiEnvelope<AgentKnowledgeBase[]>];
    if (!profilePayload.data || !providerPayload.data || !personaPayload.data || !pluginPayload.data || !skillPayload.data || !knowledgePayload.data) throw new Error("无法加载配置文件资源");
    setProfiles(profilePayload.data); setProviders(providerPayload.data); setPersonas(personaPayload.data); setPlugins(pluginPayload.data); setSkills(skillPayload.data); setKnowledgeBases(knowledgePayload.data);
    const current = profilePayload.data.find((item) => item.id === preferredId) ?? profilePayload.data[0];
    if (current) selectProfile(current); else setForm(createEmpty(providerPayload.data[0]?.id, personaPayload.data[0]?.id));
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setMessage(String(error)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectProfile(item: AgentConfigProfile) {
    setSelectedId(item.id); setTab("ai");
    setForm({ ...item, temperature: String(item.temperature), maxSteps: String(item.maxSteps), maxRetries: String(item.maxRetries), contextMaxTurns: String(item.contextMaxTurns), contextDiscardTurns: String(item.contextDiscardTurns), contextKeepRecentRatio: String(item.contextKeepRecentRatio), maxContextTokens: String(item.maxContextTokens) });
  }
  function startCreate() { setSelectedId(null); setTab("ai"); setMessage(""); setForm(createEmpty(providers[0]?.id, personas[0]?.id)); }

  async function save() {
    const response = await fetch(selectedId ? `/api/agent/config-profiles/${encodeURIComponent(selectedId)}` : "/api/agent/config-profiles", { method: selectedId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, temperature: Number(form.temperature), maxSteps: Number(form.maxSteps), maxRetries: Number(form.maxRetries), contextMaxTurns: Number(form.contextMaxTurns), contextDiscardTurns: Number(form.contextDiscardTurns), contextKeepRecentRatio: Number(form.contextKeepRecentRatio), maxContextTokens: Number(form.maxContextTokens), contextCompressionProviderId: form.contextCompressionProviderId || null }) });
    const payload = (await response.json()) as ApiEnvelope<AgentConfigProfile>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setSelectedId(payload.data.id); setMessage("配置文件已保存"); await load(payload.data.id);
  }
  async function remove() { if (!selectedId) return; const response = await fetch(`/api/agent/config-profiles/${encodeURIComponent(selectedId)}`, { method: "DELETE" }); const payload = (await response.json()) as ApiEnvelope<unknown>; if (!response.ok) return setMessage(payload.message); setSelectedId(null); setMessage("配置文件已删除"); await load(null); }

  return <section className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-4">
    <aside className="theme-panel flex min-h-0 flex-col rounded-[22px] p-3 shadow-[var(--shadow-card)]">
      <Button fullWidth className="shrink-0" onPress={startCreate}>添加配置文件</Button>
      <nav className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {profiles.map((item) => <Button key={item.id} fullWidth variant="ghost" onPress={() => selectProfile(item)} className={`h-auto min-h-0 justify-start rounded-xl px-3 py-2.5 text-left ${selectedId === item.id ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--color-text-secondary)]">{providers.find((provider) => provider.id === item.providerId)?.name ?? "未选择模型提供商"}</span></span></Button>)}
      </nav>
    </aside>

    <Tabs variant="secondary" selectedKey={tab} onSelectionChange={(key) => setTab(key as Tab)} className="theme-panel flex min-h-0 flex-col overflow-hidden rounded-[22px] shadow-[var(--shadow-card)]">
      <header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Input aria-label="配置文件名称" fullWidth className="max-w-md text-lg font-semibold" value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} />
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selectedId ? "编辑配置文件" : "正在创建新配置文件"}</p>
          </div>
          <div className="flex gap-2">
            {selectedId ? <Button variant="ghost" className="text-[var(--color-danger)]" onPress={() => void remove()}>删除</Button> : null}
            <Button onPress={() => void save()}>保存</Button>
          </div>
        </div>
        <Tabs.ListContainer className="mt-4 overflow-x-auto">
          <Tabs.List aria-label="配置文件设置" className="min-w-max">
            {profileTabs.map((item) => <Tabs.Tab key={item.id} id={item.id} className="px-3 py-2 text-xs font-medium">{item.label}<Tabs.Indicator /></Tabs.Tab>)}
          </Tabs.List>
        </Tabs.ListContainer>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <Tabs.Panel id="ai" className="outline-none"><AiConfig form={form} setForm={setForm} providers={providers} personas={personas} /></Tabs.Panel>
        <Tabs.Panel id="platform" className="outline-none"><PlatformConfig form={form} setForm={setForm} knowledgeBases={knowledgeBases} /></Tabs.Panel>
        <Tabs.Panel id="plugins" className="outline-none"><BindingConfig title="插件" items={plugins} value={form.pluginIds} onChange={(pluginIds) => setForm({ ...form, pluginIds })} /></Tabs.Panel>
        <Tabs.Panel id="skills" className="outline-none"><BindingConfig title="Skills" items={skills} value={form.skillIds} onChange={(skillIds) => setForm({ ...form, skillIds })} /></Tabs.Panel>
        {message ? <p className="mt-4 rounded-lg bg-[var(--color-bg-subtle)] p-3 text-sm">{message}</p> : null}
      </div>
    </Tabs>
  </section>;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <section className="mb-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4"><h3 className="text-sm font-semibold">{title}</h3>{description ? <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{description}</p> : null}<div className="mt-4 space-y-4">{children}</div></section>; }

function AiConfig({ form, setForm, providers, personas }: { form: ProfileForm; setForm: React.Dispatch<React.SetStateAction<ProfileForm>>; providers: AgentModelProvider[]; personas: AgentPersona[] }) {
  const providerOptions = providers.map((item) => ({ value: item.id, label: item.name }));
  const personaOptions = personas.map((item) => ({ value: item.id, label: item.name }));
  return <>
    <Section title="模型">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="模型提供商"><SettingSelect ariaLabel="模型提供商" value={form.providerId} options={providerOptions} onChange={(providerId) => setForm({ ...form, providerId })} /></Field>
        <Field label="请求最大重试次数"><Input fullWidth type="number" min="0" max="20" value={form.maxRetries} onChange={(event) => setForm({ ...form, maxRetries: event.currentTarget.value })} /></Field>
        <Field label="对话模型"><Input fullWidth value={form.chatModel} onChange={(event) => setForm({ ...form, chatModel: event.currentTarget.value })} /></Field>
        <Field label="Embedding 模型"><Input fullWidth value={form.embeddingModel} onChange={(event) => setForm({ ...form, embeddingModel: event.currentTarget.value })} /></Field>
        <Field label="默认图片转述模型"><Input fullWidth value={form.imageCaptionModel} onChange={(event) => setForm({ ...form, imageCaptionModel: event.currentTarget.value })} placeholder="留空则使用当前对话模型" /></Field>
      </div>
    </Section>
    <Section title="人格"><Field label="选择人格"><SettingSelect ariaLabel="选择人格" value={form.personaId} options={personaOptions} onChange={(personaId) => setForm({ ...form, personaId })} /></Field></Section>
    <Section title="联网搜索能力">
      <Switch isSelected={form.webSearchEnabled} onChange={(webSearchEnabled) => setForm({ ...form, webSearchEnabled })}>
        <Switch.Content>允许 Agent 使用联网搜索能力</Switch.Content>
        <Switch.Control><Switch.Thumb /></Switch.Control>
      </Switch>
    </Section>
    <Section title="上下文管理策略" description="控制普通会话历史截断、LLM 压缩及上下文窗口兜底行为。">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="压缩前最多保留对话轮数" hint="-1 表示不按轮数限制。"><Input fullWidth type="number" min="-1" value={form.contextMaxTurns} onChange={(event) => setForm({ ...form, contextMaxTurns: event.currentTarget.value })} /></Field>
        <Field label="轮次超限时一次丢弃轮数"><Input fullWidth type="number" min="1" value={form.contextDiscardTurns} onChange={(event) => setForm({ ...form, contextDiscardTurns: event.currentTarget.value })} /></Field>
        <Field label="历史超限时处理方式"><SettingSelect ariaLabel="历史超限时处理方式" value={form.contextOverflowStrategy} options={[{ value: "llm_compress", label: "由 LLM 压缩上下文" }, { value: "truncate", label: "按对话轮数截断" }]} onChange={(contextOverflowStrategy) => setForm({ ...form, contextOverflowStrategy })} /></Field>
        <Field label="压缩时保留最近上下文比例" hint="范围 0–0.3。"><Input fullWidth type="number" min="0" max="0.3" step="0.01" value={form.contextKeepRecentRatio} onChange={(event) => setForm({ ...form, contextKeepRecentRatio: event.currentTarget.value })} /></Field>
        <Field label="用于上下文压缩的模型提供商 ID" hint="留空使用当前聊天模型。"><SettingSelect ariaLabel="上下文压缩模型提供商" value={form.contextCompressionProviderId ?? ""} options={[{ value: "", label: "未选择" }, ...providerOptions]} onChange={(contextCompressionProviderId) => setForm({ ...form, contextCompressionProviderId })} /></Field>
        <Field label="上下文窗口兜底值"><Input fullWidth type="number" min="0" value={form.maxContextTokens} onChange={(event) => setForm({ ...form, maxContextTokens: event.currentTarget.value })} /></Field>
      </div>
      <Field label="上下文压缩提示词" hint="为空时由后端使用默认提示词。"><TextArea fullWidth className="min-h-44 font-mono text-xs leading-5" value={form.contextCompressionPrompt} onChange={(event) => setForm({ ...form, contextCompressionPrompt: event.currentTarget.value })} /></Field>
    </Section>
  </>;
}

function PlatformConfig({ form, setForm, knowledgeBases }: { form: ProfileForm; setForm: React.Dispatch<React.SetStateAction<ProfileForm>>; knowledgeBases: AgentKnowledgeBase[] }) { return <><Section title="执行参数"><div className="grid gap-4 sm:grid-cols-2"><Field label="Temperature"><Input fullWidth type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => setForm({ ...form, temperature: event.currentTarget.value })} /></Field><Field label="最大执行步骤"><Input fullWidth type="number" min="1" max="30" value={form.maxSteps} onChange={(event) => setForm({ ...form, maxSteps: event.currentTarget.value })} /></Field></div></Section><BindingConfig title="知识库" items={knowledgeBases} value={form.knowledgeBaseIds} onChange={(knowledgeBaseIds) => setForm({ ...form, knowledgeBaseIds })} /></>; }

function BindingConfig({ title, items, value, onChange }: { title: string; items: Array<{ id: string; name: string; description: string; enabled: boolean }>; value: string[]; onChange: (value: string[]) => void }) { return <Section title={title} description={`选择此配置文件允许使用的${title}。`}><div className="grid gap-2 sm:grid-cols-2">{items.map((item) => <Checkbox key={item.id} isSelected={value.includes(item.id)} isDisabled={!item.enabled} onChange={(checked) => onChange(checked ? [...value, item.id] : value.filter((id) => id !== item.id))} className="items-start rounded-xl border border-[var(--color-border)] p-3"><Checkbox.Control className="mt-0.5"><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content><span className="block text-sm font-medium">{item.name}</span><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{item.description || "暂无描述"}</span></Checkbox.Content></Checkbox>)}{items.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">暂无可用资源</p> : null}</div></Section>; }

function SettingSelect({ ariaLabel, value, options, onChange }: { ariaLabel: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const selectedLabel = options.find((item) => item.value === value)?.label ?? "请选择";
  const selectedKey = value || (options.some((item) => item.value === "") ? "__empty__" : null);
  return <Select aria-label={ariaLabel} fullWidth selectedKey={selectedKey} onSelectionChange={(key: Key | null) => onChange(key === null || key === "__empty__" ? "" : String(key))}>
    <Select.Trigger><Select.Value>{selectedLabel}</Select.Value><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{options.map((item) => <ListBox.Item key={item.value || "__empty__"} id={item.value || "__empty__"} textValue={item.label}>{item.label}</ListBox.Item>)}</ListBox></Select.Popover>
  </Select>;
}
