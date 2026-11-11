"use client";
import { KnowledgeManager } from "@/features/knowledge/KnowledgeManager";
import { SettingsContentCard } from "../components/SettingsContentCard";
export default function GlobalKnowledgePage() {
  return (
    <SettingsContentCard title="全局知识库">
      <KnowledgeManager kind="global" />
    </SettingsContentCard>
  );
}
