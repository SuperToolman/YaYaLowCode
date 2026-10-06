"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAutomationFlow } from "@features/automation-editor/api";
import { getForm } from "@features/form-runtime/api";
import {
  AUTOMATION_TITLE_CHANGED_EVENT,
  type AutomationTitleChangedDetail,
} from "./automation-title-events";

export function AppCurrentPageTitle({ appId }: { appId: string }) {
  const pathname = usePathname();
  const [resolvedTitle, setResolvedTitle] = useState<{ pathname: string; title: string } | null>(null);
  const fallbackTitle = pathname.startsWith(`/${appId}/settings`)
    ? "设置"
    : pathname.startsWith(`/${appId}/automations`)
      ? "集成自动化"
      : "页面管理";

  useEffect(() => {
    const automationMatch = pathname.match(
      new RegExp(`^/${escapeRegExp(appId)}/automations/([^/]+)$`),
    );
    const formMatch = pathname.match(
      new RegExp(`^/${escapeRegExp(appId)}/([^/]+)$`),
    );

    let cancelled = false;
    if (automationMatch?.[1]) {
      void getAutomationFlow({ path: { automationId: automationMatch[1] }, responseStyle: "fields" })
        .then(({ data }) => {
          if (!cancelled && data?.code === 0 && data.data?.name) setResolvedTitle({ pathname, title: data.data.name });
        })
        .catch(() => undefined);
    } else if (formMatch?.[1] && !["automations", "settings", "tasks"].includes(formMatch[1])) {
      void getForm({ path: { formUuid: formMatch[1] }, responseStyle: "fields" })
        .then(({ data }) => {
          if (!cancelled && data?.code === 0 && data.data?.name) setResolvedTitle({ pathname, title: data.data.name });
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [appId, pathname]);

  useEffect(() => {
    const automationId = pathname.match(
      new RegExp(`^/${escapeRegExp(appId)}/automations/([^/]+)$`),
    )?.[1];
    if (!automationId) return;

    const updateTitle = (event: Event) => {
      const detail = (event as CustomEvent<AutomationTitleChangedDetail>).detail;
      if (detail?.automationId === automationId) setResolvedTitle({ pathname, title: detail.name });
    };
    window.addEventListener(AUTOMATION_TITLE_CHANGED_EVENT, updateTitle);
    return () => window.removeEventListener(AUTOMATION_TITLE_CHANGED_EVENT, updateTitle);
  }, [appId, pathname]);

  return <>{resolvedTitle?.pathname === pathname ? resolvedTitle.title : fallbackTitle}</>;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
