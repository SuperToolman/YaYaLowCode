"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { FaceRobot } from "@gravity-ui/icons";

const AgentAssistantLauncher = dynamic(
  () => import("./agent-assistant-launcher"),
  { ssr: false },
);

export function AgentAssistantTrigger() {
  const [isAssistantOpen, setAssistantOpen] = useState(false);

  function openAssistant() {
    setAssistantOpen(true);
  }

  return (
    <>
      <button
        type="button"
        aria-label="打开 YaYa Agent"
        className="group flex h-[68px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent bg-transparent px-2 text-center text-[var(--color-text-secondary)] transition-all duration-200 backdrop-blur-xl hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-text-primary)]"
        onClick={openAssistant}
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-control-selected)]">
          <FaceRobot className="h-5 w-5" />
        </span>
        <span className="text-[11px] font-medium leading-4">Agent</span>
      </button>
      {isAssistantOpen ? (
        <AgentAssistantLauncher
          hideTrigger
          open={isAssistantOpen}
          onOpenChange={setAssistantOpen}
        />
      ) : null}
    </>
  );
}
