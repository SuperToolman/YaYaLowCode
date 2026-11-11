"use client";

import { useEffect, useState } from "react";
import { listAutomationFlows, type AutomationFlow } from "@/features/automation-editor/api";
import { assertApiResult } from "@/shared/lib/api-request";
import { PropertyButton } from "../property-panel/PropertyControls";

/** 只读关联入口，不修改表单配置或自动化。 */
export function FormEventsPanel({
  appId,
  formUuid,
  onOpen,
}: {
  appId: string | null;
  formUuid: string;
  onOpen: (name: string) => void;
}) {
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void listAutomationFlows({ path: { appId }, responseStyle: "fields" })
        .then((result) => {
          assertApiResult(result);
          if (!cancelled)
            setFlows(
              result.data.data.items.filter(
                (flow) => flow.triggerFormUuid === formUuid,
              ),
            );
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [appId, formUuid, attempt]);

  if (!appId) return <p className="text-xs text-muted">当前表单未关联应用</p>;
  if (loading)
    return (
      <p role="status" className="text-xs text-muted">
        正在加载表单事件…
      </p>
    );
  if (failed)
    return (
      <div className="space-y-1">
        <p role="alert" className="text-xs text-danger">
          表单事件加载失败
        </p>
        <PropertyButton
          variant="ghost"
          onPress={() => setAttempt((value) => value + 1)}
        >
          重新加载
        </PropertyButton>
      </div>
    );
  if (flows.length === 0)
    return <p className="text-xs text-muted">暂无关联的集成自动化</p>;

  return (
    <div className="space-y-1">
      {flows.map((flow) => (
        <PropertyButton
          key={flow.id}
          fullWidth
          variant="ghost"
          className="h-auto min-w-0 max-w-full justify-start whitespace-normal px-2 py-2 text-left md:h-auto"
          onPress={() => onOpen(flow.name)}
        >
          <span className="block min-w-0 flex-1 space-y-0.5 overflow-hidden text-xs leading-4">
            <span className="block truncate text-xs leading-4" title={flow.name}>
              {flow.name}
            </span>
            <span className="block text-xs leading-4 break-words whitespace-normal text-muted">
              {flow.triggerLabel} ·{" "}
              {flow.status === "enabled" ? "已启动" : "已停止"}
            </span>
          </span>
        </PropertyButton>
      ))}
    </div>
  );
}
