"use client";

import { Check, Xmark } from "@gravity-ui/icons";
import { Button, Label } from "@heroui/react";
import { MySurface } from "@/shared/ui/MySurface";
import { useEffect, useState } from "react";
import type { Confirmation } from "../client";

const statuses: Record<string, string> = {
  pending: "等待确认",
  approved: "已批准，等待执行",
  rejected: "已拒绝",
  expired: "已过期",
  cancelled: "已取消",
  executed: "已执行",
  failed: "执行失败",
  conflict: "资源已变化，请重新生成预览",
};
export function ConfirmationCard({
  confirmation,
  disabled,
  onDecision,
}: {
  confirmation: Confirmation;
  disabled?: boolean;
  onDecision: (approve: boolean) => void;
}) {
  const deadline = Date.parse(confirmation.expires_at);
  const [now, setNow] = useState(() => Date.now());
  const expired = !Number.isFinite(deadline) || deadline <= now;
  useEffect(() => {
    if (
      confirmation.status !== "pending" ||
      !Number.isFinite(deadline) ||
      deadline <= now
    )
      return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(deadline - now + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [confirmation.status, deadline, now]);
  const preview = object(confirmation.preview);
  const resource = object(preview?.resource);
  const changes = array(preview?.changes);
  const impacts = array(preview?.impacts);
  const warnings = array(preview?.warnings).filter(
    (value): value is string => typeof value === "string",
  );
  const designBaseline = object(preview?.designBaseline);
  return (
    <MySurface
      className="flex min-w-0 flex-col gap-3"
      aria-label={`操作确认 ${confirmation.tool_name}`}
    >
      <Label>
        {typeof preview?.title === "string"
          ? preview.title
          : confirmation.tool_name}{" "}
        ·{" "}
        {confirmation.status === "pending" && expired
          ? "已过期，等待状态同步"
          : (statuses[confirmation.status] ?? confirmation.status)}
      </Label>
      {resource && (
        <div className="flex flex-wrap items-center gap-2">
          <span>{display(resource.name)}</span>
          <code>{display(resource.id)}</code>
        </div>
      )}
      {designBaseline && (
        <section aria-label="设计基准" className="flex min-w-0 flex-col gap-1">
          <Label>基于设计版本 {display(designBaseline.baseVersion)}</Label>
        </section>
      )}
      {preview?.version === 1 ? (
        <>
          {changes.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
              {changes.map((value, index) => {
                const change = object(value);
                return (
                  <div key={index} className="contents">
                    <dt>{display(change?.label)}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words">
                      {display(change?.before)} → {display(change?.after)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          {impacts.length > 0 && (
            <section aria-label="操作影响" className="flex flex-col gap-2">
              {impacts.map((value, index) => {
                const impact = object(value);
                return (
                  <p key={index}>
                    {display(impact?.label)}：{display(impact?.count)}。
                    {display(impact?.description)}
                  </p>
                );
              })}
            </section>
          )}
          {warnings.map((warning, index) => (
            <p key={index} role="note">
              {warning}
            </p>
          ))}
        </>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
          {JSON.stringify(confirmation.preview, null, 2)}
        </pre>
      )}
      <span>有效期至 {new Date(confirmation.expires_at).toLocaleString()}</span>
      {confirmation.status === "pending" && (
        <div className="flex items-center gap-2">
          <Button
            isDisabled={disabled || expired}
            onPress={() => onDecision(true)}
          >
            <Check />
            确认执行
          </Button>
          <Button
            variant="secondary"
            isDisabled={disabled || expired}
            onPress={() => onDecision(false)}
          >
            <Xmark />
            拒绝
          </Button>
        </div>
      )}
      {confirmation.result != null && (
        <section aria-label="执行结果">
          <Label>执行结果</Label>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(confirmation.result, null, 2)}
          </pre>
        </section>
      )}
    </MySurface>
  );
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function display(value: unknown): string {
  return value == null
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}
