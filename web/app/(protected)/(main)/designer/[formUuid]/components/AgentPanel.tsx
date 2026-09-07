"use client";

import { useEffect, useState } from "react";
import { Button, ListBox, Select, TextArea, Tooltip } from "@heroui/react";
import { InfoIcon } from "../../../../../components/app-icons";
import { fetchAvailableAgents } from "../../../../../../features/agent-assistant/api";
import type { AgentOption } from "../../../../../../features/agent-assistant/types";
import type { PageDesignerProps } from "../designer-types";

type SystemAiStatus = {
  available: boolean;
  providerId?: string;
  providerName?: string;
  reason?: string;
};

type ModelRouteStatus = {
  enabled?: boolean;
  isDefault?: boolean;
  apiBaseUrl?: string;
  defaultChatModel?: string;
};

type AgentPanelProps = {
  value: PageDesignerProps["agent"];
  onChange: (value: PageDesignerProps["agent"]) => void;
};

export function AgentPanel({ value, onChange }: AgentPanelProps) {
  const [systemAi, setSystemAi] = useState<SystemAiStatus | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const statusRequest = fetch("/api/agent/system-ai/status", { cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as { code: number; message: string; data: SystemAiStatus | null };
          if (!response.ok || !payload.data) throw new Error(payload.message || "无法加载系统 AI 状态");
          return payload.data;
        });
      const routesRequest = fetch("/api/settings/model-routes", { cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as { code?: number; data?: ModelRouteStatus[]; message?: string };
          if (!response.ok || payload.code !== 0 || !Array.isArray(payload.data)) throw new Error(payload.message || "无法加载模型供应商");
          return payload.data;
        });

      const [statusResult, routesResult] = await Promise.allSettled([statusRequest, routesRequest]);
      if (cancelled) return;

      if (statusResult.status === "fulfilled") setSystemAi(statusResult.value);
      else setSystemAi({ available: false, reason: statusResult.reason instanceof Error ? statusResult.reason.message : "无法加载系统 AI 状态" });

      if (routesResult.status === "fulfilled") {
        const configured = routesResult.value.some((route) => Boolean(route.isDefault && route.enabled && route.apiBaseUrl?.trim() && route.defaultChatModel?.trim()));
        setProviderReady(configured);
      } else {
        setProviderReady(statusResult.status === "fulfilled" && statusResult.value.available);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAvailableAgents({ route: "/designer" })
      .then((items) => { if (!cancelled) setAgents(items.filter((item) => item.isAiEmployee)); })
      .catch(() => { if (!cancelled) setAgents([]); });
    return () => { cancelled = true; };
  }, []);

  const selectedAgent = agents.find((agent) => agent.id === value.agentId);
  const agentEnabled = value.enabled && Boolean(value.agentId);
  const selectedAgentName = selectedAgent?.name;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Agent 功能与 AI 员工"
          fullWidth
          selectedKey={agentEnabled ? value.agentId : "none"}
          isDisabled={loading || agents.length === 0}
          onSelectionChange={(key) => {
            const selected = String(key ?? "none");
            onChange(selected === "none" ? { ...value, agentId: "", enabled: false } : { ...value, agentId: selected, enabled: true });
          }}>
          <Select.Trigger><Select.Value>{selectedAgentName ?? "不开启 Agent"}</Select.Value></Select.Trigger>
          <Select.Popover><ListBox aria-label="Agent 功能与 AI 员工列表"><ListBox.Item id="none">不开启 Agent</ListBox.Item>{agents.map((agent) => <ListBox.Item key={agent.id} id={agent.id} textValue={agent.name}>{agent.name}<span className="ml-2 text-xs text-[var(--color-text-secondary)]">{agent.description}</span></ListBox.Item>)}</ListBox></Select.Popover>
        </Select>
        <Tooltip
          delay={0}
          closeDelay={100}>
          <Tooltip.Trigger>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Agent 功能说明">
              <InfoIcon />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <div className="max-w-64 space-y-1 text-xs leading-5">
              <p>保存后，新增数据抽屉将使用默认模型供应商提供 AI 填表。</p>
              <p>选择 AI 员工后，新增数据时会由该员工负责业务对话。</p>
              <p>表单提示词会作为 Agent 对话的业务背景。</p>
            </div>
          </Tooltip.Content>
        </Tooltip>
      </div>

      {agentEnabled ? <>
        <div>
          <div className="flex justify-between items-center text-xs font-medium text-[var(--color-text-secondary)]">
            <p>表单描述提示词</p>
            <Tooltip
              delay={0}
              closeDelay={100}>
              <Tooltip.Trigger>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Agent 功能说明">
                  <InfoIcon />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                该提示词会作为此表单 Agent 对话的业务背景。
              </Tooltip.Content>
            </Tooltip>

          </div>
          <TextArea fullWidth className="min-h-40 text-sm leading-6" placeholder="例如：你是采购申请助手，请结合当前表单结构帮助用户梳理申请信息、检查缺失内容并给出业务建议。" value={value.prompt} onChange={(event) => onChange({ ...value, prompt: event.currentTarget.value })} />
        </div>

      </> : null}
    </div>
  );
}
