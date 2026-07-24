"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Button, Input, ListBox, Modal, Select, Switch } from "@heroui/react";
import { Field } from "../_components/field";
import { SettingsContentCard } from "../_components/settings-content-card";
import type { AgentConfigProfile, AgentDefinition, ApiEnvelope } from "../agent-types";

type RobotForm = { name: string; description: string; enabled: boolean; profileId: string };

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [profiles, setProfiles] = useState<AgentConfigProfile[]>([]);
  const [editing, setEditing] = useState<AgentDefinition | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<RobotForm>({ name: "", description: "", enabled: true, profileId: "" });

  async function load() {
    const [agentsResponse, profilesResponse] = await Promise.all([fetch("/api/agents", { cache: "no-store" }), fetch("/api/agent/config-profiles", { cache: "no-store" })]);
    const agentsPayload = (await agentsResponse.json()) as ApiEnvelope<AgentDefinition[]>;
    const profilesPayload = (await profilesResponse.json()) as ApiEnvelope<AgentConfigProfile[]>;
    if (!agentsPayload.data || !profilesPayload.data) throw new Error(agentsPayload.message || profilesPayload.message);
    setAgents(agentsPayload.data); setProfiles(profilesPayload.data);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setMessage(String(error)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", enabled: true, profileId: profiles[0]?.id ?? "" });
    setIsOpen(true);
  }

  function openEdit(agent: AgentDefinition) {
    setEditing(agent);
    setForm({ name: agent.name, description: agent.description, enabled: agent.enabled, profileId: agent.profileId });
    setIsOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(editing ? `/api/agents/${encodeURIComponent(editing.id)}` : "/api/agents", {
      method: editing ? "PUT" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, isDefault: editing?.isDefault ?? false, scopeType: "platform", scopeRefId: null, systemPrompt: "", pluginIds: [], skillIds: [], knowledgeBaseIds: [] }),
    });
    const payload = (await response.json()) as ApiEnvelope<AgentDefinition>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setIsOpen(false); setMessage(editing ? "机器人已更新" : "机器人已创建"); await load();
  }

  return <SettingsContentCard
    title="机器人"
    subtitle={`管理平台中可用的 Agent 实例及其配置文件。当前共 ${agents.length} 个机器人。`}
    headerActions={<Button onPress={openCreate}>新增机器人</Button>}
  >
    {message ? <p className="mb-4 rounded-lg bg-[var(--color-bg-subtle)] px-4 py-3 text-sm">{message}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{agents.map((agent) => { const profile = profiles.find((item) => item.id === agent.profileId); return <Button key={agent.id} variant="ghost" fullWidth onPress={() => openEdit(agent)} className="group h-auto min-h-36 justify-start rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-card-hover)]"><span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-base text-[var(--color-primary)]">机</span><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${agent.enabled ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"}`}>{agent.enabled ? "已启用" : "已停用"}</span></span><span className="mt-3 block break-words text-base font-semibold">{agent.name}</span><span className="mt-1 line-clamp-2 block min-h-10 text-xs leading-5 text-[var(--color-text-secondary)]">{agent.description || "暂无描述"}</span><span className="mt-3 block truncate text-[11px] text-[var(--color-primary)]">{profile?.name ?? "未绑定配置文件"}</span></span></Button>; })}</div>
    {!agents.length ? <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-text-secondary)]">尚未创建机器人。</div> : null}

    <Modal isOpen={isOpen} onOpenChange={setIsOpen}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="md"><Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><Modal.Header className="border-b border-[var(--color-border)] px-5 py-4"><Modal.Heading className="text-lg font-semibold">{editing ? "编辑机器人" : "新增机器人"}</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><form onSubmit={save}><Modal.Body className="space-y-4 px-5 py-5"><Field label="机器人名称"><Input autoFocus fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field><Field label="配置文件"><Select aria-label="配置文件" fullWidth selectedKey={form.profileId || null} onSelectionChange={(key: Key | null) => setForm({ ...form, profileId: key === null ? "" : String(key) })}><Select.Trigger><Select.Value>{profiles.find((profile) => profile.id === form.profileId)?.name ?? "请选择配置文件"}</Select.Value><Select.Indicator /></Select.Trigger><Select.Popover><ListBox>{profiles.map((profile) => <ListBox.Item key={profile.id} id={profile.id} textValue={profile.name}>{profile.name}</ListBox.Item>)}</ListBox></Select.Popover></Select></Field><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content>启用机器人</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Modal.Body><Modal.Footer className="border-t border-[var(--color-border)] px-5 py-4"><Button variant="ghost" onPress={() => setIsOpen(false)}>取消</Button><Button type="submit">保存</Button></Modal.Footer></form></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </SettingsContentCard>;
}
