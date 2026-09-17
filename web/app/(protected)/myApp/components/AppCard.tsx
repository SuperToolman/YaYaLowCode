"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Calendar, Clock, Ellipsis } from "@gravity-ui/icons";
import { Avatar, Typography, Card, Chip, Dropdown } from "@heroui/react";
import type { AppItem } from "@/app/lib/apps";
import { MyAvatar } from "@/app/components/my-fields/MyAvatar";

type AppCardProps = {
  app: AppItem;
  actions?: ReactNode;
  onOpen: () => void;
};

export function AppCard({ app, actions, onOpen }: AppCardProps) {
  const openFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <Card
      className="border-l-3 border-[var(--color-primary)]"
      role="link"
      tabIndex={0}
      aria-label={`打开 ${app.name}`}
      onClick={onOpen}
      onKeyDown={openFromKeyboard}
    >
      <Card.Header>
        <div className="flex flex-wrap justify-between">
          <div className="flex items-center gap-2">
            <MyAvatar name={app.name} />
            <Typography type="h5">{app.name}</Typography>
          </div>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        <Typography
          type="body-sm"
          className="line-clamp-2 leading-6 h-12 min-h-12 max-h-12"
        >
          {app.desc || "暂无说明"}
        </Typography>

        <div className="flex items-center justify-between">
          {/* content left */}
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{app.badge || "普通应用"}</Chip>
            {app.deploymentType === "online" ? (
              <Chip>线上 {app.onlineVersion || "应用"}</Chip>
            ) : null}
            <Chip>
              <Clock />
              {app.records} 条记录
            </Chip>
            <Chip>
              <Calendar />
              {app.createdAt}
            </Chip>
          </div>

          {/* content right */}
          <div className="flex flex-wrap items-center gap-2">
            {actions ? (
              <div
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Dropdown>
                  <Dropdown.Trigger aria-label={`${app.name} 更多操作`}>
                    <Ellipsis />
                  </Dropdown.Trigger>
                  <Dropdown.Popover>{actions}</Dropdown.Popover>
                </Dropdown>
              </div>
            ) : null}
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}
