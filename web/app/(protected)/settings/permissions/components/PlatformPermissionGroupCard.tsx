"use client";

import { Card, Checkbox, Description, Label } from "@heroui/react";
import { StatusTag } from "./PermissionFeedback";
import type { PermissionState } from "./permission-types";

type PermissionItem = {
  key: string;
  label: string;
  description?: string;
  ariaLabel?: string;
  disabled?: boolean;
};

type PlatformPermissionGroupCardProps = {
  title: string;
  description: string;
  selectAllLabel?: string;
  items: readonly PermissionItem[];
  grants: Set<string>;
  onToggle: (grant: string) => void;
  onSetGroup: (keys: readonly string[], checked: boolean) => void;
  className?: string;
  contentClassName?: string;
  isReadOnly?: boolean;
};

export function PlatformPermissionGroupCard({
  title,
  description,
  selectAllLabel,
  items,
  grants,
  onToggle,
  onSetGroup,
  className,
  contentClassName = "",
  isReadOnly = false,
}: PlatformPermissionGroupCardProps) {
  const locked = grants.has("*");
  const keys = items.filter((item) => !item.disabled).map((item) => item.key);
  const status: PermissionState = !keys.length
    ? "none"
    : locked || keys.every((key) => grants.has(key))
      ? "all"
      : keys.some((key) => grants.has(key))
        ? "partial"
        : "none";

  const grantedCount = locked
    ? keys.length
    : keys.filter((key) => grants.has(key)).length;

  return (
    <Card className={` gap-0 p-0 shadow-lg ${className ?? ""}`}>
      <Card.Header className="flex-row items-start justify-between gap-2 border-b border-separator/20 bg-default/20 p-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Card.Title className="flex gap-2 items-center text-base font-semibold">
            {title}
            <Description className="text-xs leading-relaxed">
              {description}
            </Description>
          </Card.Title>
        </div>

        <div className="flex items-center gap-2">
          <StatusTag
            value={
              status === "all"
                ? "全部授权"
                : status === "partial"
                  ? "部分授权"
                  : "未授权"
            }
            tone={status}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Checkbox
              aria-label={selectAllLabel ?? `授予${title}下全部权限`}
              isSelected={status === "all"}
              isIndeterminate={status === "partial"}
              isDisabled={locked || isReadOnly}
              onChange={(checked) => onSetGroup(keys, checked)}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label className="text-xs text-muted">全选本组</Label>
              </Checkbox.Content>
            </Checkbox>
            <span className="text-xs tabular-nums text-muted">
              已授权 {grantedCount} / {keys.length} 项
            </span>
          </div>
        </div>
      </Card.Header>
      <Card.Content className="gap-4 p-2">
        <div
          className={`grid auto-rows-fr gap-2 sm:grid-cols-5 ${contentClassName}`}
        >
          {items.map((item) => {
            const selected = locked || grants.has(item.key);
            const disabled = locked || isReadOnly || item.disabled;
            return (
              <Checkbox
                key={item.key}
                isSelected={selected}
                isDisabled={disabled}
                onChange={() => onToggle(item.key)}
                aria-label={
                  item.ariaLabel ?? `${item.label}：${item.description ?? ""}`
                }
                className="h-full min-w-0"
              >
                <Checkbox.Content
                  className={`h-full w-full min-w-0 items-start gap-3 rounded-xl border p-3 transition-colors motion-reduce:transition-none ${
                    selected
                      ? "border-accent/25 bg-accent-soft/50"
                      : "border-separator/70"
                  } ${disabled ? "" : "hover:border-accent/40 hover:bg-accent-soft/40"}`}
                >
                  <Checkbox.Control className="mt-0.5 shrink-0">
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <Label className="break-words leading-5">
                      {item.label}
                    </Label>
                    {item.description ? (
                      <span className="text-xs leading-relaxed break-words text-muted">
                        {item.description}
                      </span>
                    ) : null}
                    {item.disabled ? (
                      <span className="text-xs text-muted">暂不可用</span>
                    ) : null}
                  </span>
                </Checkbox.Content>
              </Checkbox>
            );
          })}
        </div>
      </Card.Content>
    </Card>
  );
}
