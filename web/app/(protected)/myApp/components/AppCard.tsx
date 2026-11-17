"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, Calendar, Ellipsis, Person } from "@gravity-ui/icons";
import { Button, Card, Dropdown } from "@heroui/react";
import type { AppColorTone, AppItem } from "@/features/application/types";

type AppCardProps = {
  app: AppItem;
  actions?: ReactNode;
  onOpen: () => void;
};

const toneClasses: Record<AppColorTone, string> = {
  primary: "[--app-card-tone:var(--color-primary)]",
  secondary: "[--app-card-tone:var(--color-secondary)]",
  accent: "[--app-card-tone:var(--color-accent)]",
  success: "[--app-card-tone:var(--color-success)]",
  warning: "[--app-card-tone:var(--color-warning)]",
};

export function AppCard({ app, actions, onOpen }: AppCardProps) {
  return (
    <Card
      className={`group relative flex min-w-0 flex-col gap-0 rounded-[14px]! border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg-surface)_85%,transparent)] px-[22px] pt-[22px] pb-0 shadow-none transition-[border-color,box-shadow] duration-180 hover:border-[color-mix(in_srgb,var(--app-card-tone)_55%,var(--color-border))] hover:shadow-[var(--shadow-sm)] focus-within:border-[color-mix(in_srgb,var(--app-card-tone)_55%,var(--color-border))] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[var(--color-primary)] motion-reduce:transition-none ${toneClasses[app.color]}`}
    >
      <div className="mb-[18px] flex items-center gap-2.5">
        <span
          className="grid size-[46px] shrink-0 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--app-card-tone)_18%,transparent)] bg-[color-mix(in_srgb,var(--app-card-tone)_12%,transparent)] text-[21px] font-semibold text-[var(--app-card-tone)]"
          aria-hidden="true"
        >
          {app.name.trim().slice(0, 1) || "A"}
        </span>
        {actions ? (
          <Dropdown>
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              aria-label={`${app.name} 更多操作`}
              className="relative z-10 ml-auto shrink-0 text-[var(--color-text-secondary)]"
            >
              <Ellipsis width={18} height={18} />
            </Button>
            <Dropdown.Popover>{actions}</Dropdown.Popover>
          </Dropdown>
        ) : null}
      </div>
      <Button
        variant="tertiary"
        className="static block h-auto w-full min-w-0 transform-none border-0 bg-transparent p-0 text-left whitespace-normal text-inherit after:absolute after:inset-0 after:rounded-[14px] after:content-[''] hover:bg-transparent focus-visible:outline-none [&_h3]:truncate [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-[-.02em]"
        onPress={onOpen}
        aria-label={`打开 ${app.name}`}
      >
        <h3 title={app.name}>{app.name}</h3>
        <p className="mt-2 line-clamp-2 h-11 text-[13px] leading-[22px] wrap-anywhere text-[var(--color-text-secondary)]">
          {app.desc || "还没有应用介绍，进入应用探索更多。"}
        </p>
        <div className="my-5 flex min-h-[26px] flex-wrap items-center gap-1.5">
          <span className="rounded-[5px] bg-[var(--color-control-soft)] px-[7px] py-[3px] text-[10px] text-[var(--color-text-secondary)]">
            {app.badge || "普通应用"}
          </span>
          {app.deploymentType === "online" ? (
            <span className="rounded-[5px] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] px-[7px] py-[3px] text-[10px] text-[var(--color-primary)]">
              线上 {app.onlineVersion || "应用"}
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-[var(--color-text-secondary)] [&_strong]:text-sm [&_strong]:font-[550] [&_strong]:text-[var(--color-text-primary)] [&_strong]:tabular-nums">
            <strong>{app.records.toLocaleString("zh-CN")}</strong> 条记录
          </span>
        </div>
        <div className="flex h-[49px] items-center gap-3 border-t border-[color-mix(in_srgb,var(--color-border)_70%,transparent)] text-[11px] text-[var(--color-text-secondary)] [&_svg]:size-[13px] [&_svg]:shrink-0">
          <span
            className="flex min-w-0 items-center gap-[5px] overflow-hidden text-ellipsis whitespace-nowrap"
            title={app.owner || "未设置负责人"}
          >
            <Person />
            {app.owner || "未设置负责人"}
          </span>
          <span className="ml-auto flex items-center gap-[5px] whitespace-nowrap">
            <Calendar />
            {app.createdAt.slice(0, 10)}
          </span>
          <ArrowUpRight
            className="text-[var(--color-text-disabled)] transition-colors duration-180 group-hover:text-[var(--app-card-tone)] motion-reduce:transition-none"
            aria-hidden="true"
          />
        </div>
      </Button>
    </Card>
  );
}
