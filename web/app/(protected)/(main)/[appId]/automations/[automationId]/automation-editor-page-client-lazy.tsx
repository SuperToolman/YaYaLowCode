"use client";

import dynamic from "next/dynamic";

export const AutomationEditorPageClient = dynamic(
  () => import("./page-client").then((module) => module.AutomationEditorPageClient),
  {
    ssr: false,
    loading: () => <div className="min-h-[640px] animate-pulse bg-[var(--color-bg-subtle)]" aria-label="正在加载自动化编辑器" />,
  },
);
