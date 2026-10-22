"use client";

import { Description, Typography } from "@heroui/react";
import { platformPermissionGroups } from "./permission-config";
import { PlatformPermissionGroupCard } from "./PlatformPermissionGroupCard";
import type { Agent } from "./permission-types";
import { MySurface } from "@/components/ui/MySurface";

export function PlatformPermissions({
  isReadOnly = false,
  agents,
  grants,
  onToggle,
  onSetGroup,
}: {
  isReadOnly?: boolean;
  agents: Agent[];
  grants: Set<string>;
  onToggle: (grant: string) => void;
  onSetGroup: (keys: readonly string[], checked: boolean) => void;
}) {
  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Typography type="h4">平台权限</Typography>
          <Description>
            按功能分组配置访问范围，可在组标题处批量授权。
          </Description>
        </div>
      </div>
      <MySurface className="flex flex-col gap-4 p-2">
        {platformPermissionGroups.map((group) => (
          <PlatformPermissionGroupCard
            key={group.key}
            title={group.label}
            description={group.description}
            items={group.items}
            isReadOnly={isReadOnly}
            grants={grants}
            onToggle={onToggle}
            onSetGroup={onSetGroup}
          />
        ))}
        {agents.length ? (
          <PlatformPermissionGroupCard
            title="Agent 使用权限"
            description="允许调用已授权的 Agent。"
            selectAllLabel="授予全部 Agent 使用权限"
            className="lg:col-span-2"
            contentClassName="xl:grid-cols-3"
            items={agents.map((agent) => ({
              key: `agent:${agent.id}:use`,
              label: agent.name,
              description: agent.description,
              ariaLabel: agent.description || `允许调用 ${agent.name}`,
              disabled: !agent.enabled,
            }))}
            isReadOnly={isReadOnly}
            grants={grants}
            onToggle={onToggle}
            onSetGroup={onSetGroup}
          />
        ) : null}
      </MySurface>
    </section>
  );
}
