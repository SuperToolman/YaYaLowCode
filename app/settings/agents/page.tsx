"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Button, Input, ListBox, Modal, Select, Switch } from "@heroui/react";
import { Field } from "../_components/field";
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
  useEffect(() => { void load().catch((error) => setMessage(String(error))); }, []);

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
      body: JSON.stringify({ ...form, isDefault: editing?.isDefault ?? agents.length === 0, scopeType: "platform", scopeRefId: null, systemPrompt: "", pluginIds: [], skillIds: [], knowledgeBaseIds: [] }),
    });
    const payload = (await response.json()) as ApiEnvelope<AgentDefinition>;
    if (!response.ok || !payload.data) return setMessage(payload.message);
    setIsOpen(false); setMessage(editing ? "机器人已更新" : "机器人已创建"); await load();
  }

  return <section className="theme-panel h-full min-h-0 overflow-y-auto rounded-[22px] p-5 shadow-[var(--shadow-card)]">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">机器人</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">机器人通过配置文件获得模型、人格、插件和 Skills 能力。</p></div><Button onPress={openCreate}>新增机器人</Button></div>
    {message ? <p className="mt-4 rounded-lg bg-[var(--color-bg-subtle)] p-3 text-sm">{message}</p> : null}
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{agents.map((agent) => { const profile = profiles.find((item) => item.id === agent.profileId); return <Button key={agent.id} variant="ghost" fullWidth onPress={() => openEdit(agent)} className="group h-auto min-h-40 justify-start rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-card-hover)]"><span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-lg text-[var(--color-primary)]">机</span><span className={`rounded-full px-2 py-1 text-[10px] ${agent.enabled ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"}`}>{agent.enabled ? "已启用" : "已停用"}</span></span><span className="mt-4 block truncate text-base font-semibold">{agent.name}</span><span className="mt-1 line-clamp-2 block min-h-10 text-xs leading-5 text-[var(--color-text-secondary)]">{agent.description || "暂无描述"}</span><span className="mt-3 block text-[11px] text-[var(--color-primary)]">{profile?.name ?? "未绑定配置文件"}</span></span></Button>; })}</div>

    <Modal isOpen={isOpen} onOpenChange={setIsOpen}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="md"><Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><Modal.Header className="border-b border-[var(--color-border)] px-5 py-4"><Modal.Heading className="text-lg font-semibold">{editing ? "编辑机器人" : "新增机器人"}</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><form onSubmit={save}><Modal.Body className="space-y-4 px-5 py-5"><Field label="机器人名称"><Input autoFocus fullWidth value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></Field><Field label="描述"><Input fullWidth value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} /></Field><Field label="配置文件"><Select aria-label="配置文件" fullWidth selectedKey={form.profileId || null} onSelectionChange={(key: Key | null) => setForm({ ...form, profileId: key === null ? "" : String(key) })}><Select.Trigger><Select.Value>{profiles.find((profile) => profile.id === form.profileId)?.name ?? "请选择配置文件"}</Select.Value><Select.Indicator /></Select.Trigger><Select.Popover><ListBox>{profiles.map((profile) => <ListBox.Item key={profile.id} id={profile.id} textValue={profile.name}>{profile.name}</ListBox.Item>)}</ListBox></Select.Popover></Select></Field><Switch isSelected={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })}><Switch.Content>启用机器人</Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Modal.Body><Modal.Footer className="border-t border-[var(--color-border)] px-5 py-4"><Button variant="ghost" onPress={() => setIsOpen(false)}>取消</Button><Button type="submit">保存</Button></Modal.Footer></form></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </section>;
}
