"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaceRobot } from "@gravity-ui/icons";

export function AgentAssistantTrigger() {
  const pathname = usePathname();
  const isActive = pathname === "/agent" || pathname.startsWith("/agent/");

  return (
      <Link
        href="/agent"
        aria-label="打开 YaYa Agent"
        aria-current={isActive ? "page" : undefined}
        className={[
          "group flex h-[68px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border text-center transition-all duration-200 backdrop-blur-xl",
          isActive
            ? "border-[var(--sidebar-soft-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-primary)] shadow-[var(--shadow-sm)]"
            : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--sidebar-soft-border)] hover:bg-[var(--sidebar-soft-bg)] hover:text-[var(--color-text-primary)]",
        ].join(" ")}
      >
        <span className={[
          "relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
          isActive
            ? "bg-[var(--color-control-selected)] text-[var(--color-primary)]"
            : "bg-[var(--color-control-soft)] text-[var(--color-text-secondary)] group-hover:bg-[var(--color-control-soft-hover)] group-hover:text-[var(--color-text-primary)]",
        ].join(" ")}>
          <FaceRobot className="h-5 w-5" />
        </span>
        <span className="text-[11px] font-medium leading-4">Agent</span>
      </Link>
  );
}
