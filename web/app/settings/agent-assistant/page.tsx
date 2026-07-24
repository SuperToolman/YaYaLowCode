"use client";

import { useEffect, useState } from "react";
import type { Key } from "react";
import { Button, ListBox, Select, TextArea, toast } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { Field } from "../_components/field";
import { SettingsContentCard } from "../_components/settings-content-card";
import type { AgentDefinition, ApiEnvelope } from "../agent-types";

type AssistantSettings = { navigationAgentId: string | null; schemaAnalysisPrompt: string };

export default function AgentAssistantSettingsPage() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [form, setForm] = useState<AssistantSettings>({ navigationAgentId: null, schemaAnalysisPrompt: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([fetch("/api/agents", { cache: "no-store" }), fetch("/api/settings/agent-assistant", { cache: "no-store" })])
      .then(async ([agentsResponse, settingsResponse]) => {
        const agentsPayload = await agentsResponse.json() as ApiEnvelope<AgentDefinition[]>;
        const settingsPayload = await settingsResponse.json() as ApiEnvelope<AssistantSettings>;
        if (!agentsResponse.ok || !settingsResponse.ok || !agentsPayload.data || !settingsPayload.data) throw new Error(agentsPayload.message || settingsPayload.message || "无法加载 Agent 协助设置");
        setAgents(agentsPayload.data.filter((agent) => agent.enabled));
        setForm(settingsPayload.data);
      })
      .catch((error) => toast.danger("无法加载 Agent 协助设置", { description: error instanceof Error ? error.message : "请稍后重试。" }))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings/agent-assistant", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json() as ApiEnvelope<AssistantSettings>;
      if (!response.ok || !payload.data) return toast.danger("保存失败", { description: payload.message || "请稍后重试。" });
      setForm(payload.data);
      toast.success("Agent 协助设置已保存");
    } catch (error) {
      toast.danger("保存失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setSaving(false);
    }
  }

  return <section className="h-full min-h-0">
    <SettingsContentCard
      title="Agent 协助设置"
      subtitle="管理平台导航助手的机器人选择，以及表单设计器的 Schema 分析指令。"
      footer={<><p className="text-xs leading-5 text-[var(--color-text-secondary)]">保存后立即应用于新的导航会话和后续 Schema 分析。</p><Button isDisabled={loading || saving} onPress={() => void save()}>{saving ? "正在保存…" : "保存设置"}</Button></>}
    >
      <div className="space-y-4">
        <Card className="border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-[var(--color-text-primary)]">平台导航助手</h3>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">导航栏中的 Agent 助手只会创建和执行此处指定机器人的新会话。</p>
            </div>
            <span className={loading ? "rounded-full bg-[var(--color-control-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]" : "rounded-full bg-[var(--color-success-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-success)]"}>{loading ? "正在加载" : "设置已加载"}</span>
          </div>
          <div className="mt-6 max-w-xl">
            <Field label="使用的机器人">
              <Select aria-label="导航助手机器人" fullWidth isDisabled={loading || saving} selectedKey={form.navigationAgentId ?? "__none__"} onSelectionChange={(key: Key | null) => setForm({ ...form, navigationAgentId: key === null || key === "__none__" ? null : String(key) })}>
                <Select.Trigger><Select.Value>{agents.find((agent) => agent.id === form.navigationAgentId)?.name ?? "未配置"}</Select.Value><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox><ListBox.Item id="__none__" textValue="未配置">未配置</ListBox.Item>{agents.map((agent) => <ListBox.Item key={agent.id} id={agent.id} textValue={agent.name}>{agent.name}</ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Schema 分析</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">全局指令会在表单设计器分析 Schema 时与表单内的补充提示词合并发送。</p>
          </div>
          <div className="mt-6">
            <Field label="分析提示词">
              <TextArea fullWidth className="min-h-60 font-mono text-sm leading-6" disabled={loading || saving} value={form.schemaAnalysisPrompt} onChange={(event) => setForm({ ...form, schemaAnalysisPrompt: event.currentTarget.value })} />
            </Field>
          </div>
        </Card>
      </div>
    </SettingsContentCard>
  </section>;
}
