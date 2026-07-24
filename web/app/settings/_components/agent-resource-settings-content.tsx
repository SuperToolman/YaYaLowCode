"use client";

import { AgentResourcePage } from "./agent-resource-page";
import { SettingsContentCard } from "./settings-content-card";

type ResourceKind = "plugin" | "skill" | "knowledge";

const content = {
  plugin: { title: "插件", subtitle: "管理 Agent 可调用的外部工具扩展、连接配置与执行确认策略。" },
  skill: { title: "Skills", subtitle: "管理可复用的 Agent 工作流、运行指令与平台工具授权。" },
  knowledge: { title: "知识库", subtitle: "管理 Agent 可检索的业务资料与外部数据源引用。" },
} as const;

export function AgentResourceSettingsContent({ kind }: { kind: ResourceKind }) {
  const copy = content[kind];
  return <SettingsContentCard
    title={copy.title}
    subtitle={copy.subtitle}
    bodyScrollable={kind !== "skill"}
    bodyClassName="agent-resource-settings-body mt-5"
  >
    <div className={`agent-resource-settings-shell h-full min-h-0 ${kind === "skill" ? "agent-resource-settings-shell-skill" : ""}`}>
      <AgentResourcePage kind={kind} />
    </div>
  </SettingsContentCard>;
}
