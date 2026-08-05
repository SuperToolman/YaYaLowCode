"use client";

import { AgentResourcePage } from "./agent-resource-page";

type ResourceKind = "plugin" | "skill" | "knowledge";

export function AgentResourceSettingsContent({ kind }: { kind: ResourceKind }) {
  return <AgentResourcePage kind={kind} />;
}
