"use client";

import { AgentResourcePage } from "./AgentResourcePage";

type ResourceKind = "plugin" | "knowledge";

export function AgentResourceSettingsContent({ kind }: { kind: ResourceKind }) {
  return <AgentResourcePage kind={kind} />;
}
