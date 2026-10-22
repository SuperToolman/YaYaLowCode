"use client";
import { useState } from "react";
import {
  Description,
  Label,
  ListBox,
  ScrollShadow,
  SearchField,
  Tabs,
} from "@heroui/react";
import { MySurface } from "@shared/ui/MySurface";
import { Empty } from "./PermissionFeedback";
import type { Role, RoleSourceFilter } from "./permission-types";

export function RoleNavigation({
  roles,
  selectedRoleId,
  loading,
  onSelectRole,
}: {
  roles: Role[];
  selectedRoleId: string;
  loading: boolean;
  onSelectRole: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<RoleSourceFilter>("all");
  const filteredRoles = roles.filter(
    (role) =>
      (sourceFilter === "all" || role.sourceType === sourceFilter) &&
      `${role.name} ${sourceLabel(role.sourceType)}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <MySurface className="flex min-h-0 w-60 shrink-0 flex-col gap-3 overflow-hidden">
      <Tabs
        variant="secondary"
        selectedKey={sourceFilter}
        onSelectionChange={(key) => setSourceFilter(key as RoleSourceFilter)}
        className="shrink-0"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="角色来源筛选" className="w-full">
            <Tabs.Tab id="all" className="flex-1">
              全部
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="local" className="flex-1">
              平台
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="dingtalk" className="flex-1">
              钉钉
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <SearchField
        aria-label="搜索角色"
        value={search}
        onChange={setSearch}
        fullWidth
        className="shrink-0"
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="搜索角色名称或来源" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <ScrollShadow className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ListBox
          aria-label="授权角色"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selectedRoleId ? [selectedRoleId] : []}
          onSelectionChange={(keys) => {
            if (keys === "all") return;
            const id = [...keys][0];
            if (id != null) onSelectRole(String(id));
          }}
          items={filteredRoles}
          renderEmptyState={() => (
            <Empty text={loading ? "正在加载角色…" : "未找到匹配角色"} />
          )}
        >
          {(role) => (
            <ListBox.Item id={role.id} textValue={role.name}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label className="truncate">{role.name}</Label>
                <Description>{role.memberCount} 名成员</Description>
              </div>
              <SourceTag source={role.sourceType} />
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </ScrollShadow>
    </MySurface>
  );
}
function SourceTag({ source }: { source: string }) {
  return (
    <span
      data-slot="chip"
      className={`chip chip--sm chip--soft chip--${source === "dingtalk" ? "accent" : "default"}`}
    >
      <span data-slot="chip-label" className="chip__label">
        {sourceLabel(source)}
      </span>
    </span>
  );
}
function sourceLabel(source: string) {
  return source === "dingtalk" ? "钉钉" : source === "local" ? "平台" : source;
}
