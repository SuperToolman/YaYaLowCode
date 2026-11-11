"use client";

import { SidebarTreeItem } from "./SidebarTreeItem";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<ReturnType<typeof useFormSidebar>, "visibleTree" | "dragState" | "visibleExpandedGroups" | "pathname" | "toggleGroup" | "openGroupAction" | "openFormAction" | "searchQuery">;

export function SidebarTree({ visibleTree, dragState, visibleExpandedGroups, pathname, toggleGroup, openGroupAction, openFormAction, searchQuery }: Props) {
  return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {searchQuery.trim() && visibleTree.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
              没有找到匹配的导航项
            </p>
          ) : null}
          {visibleTree.map((node) => (
            <SidebarTreeItem
              key={node.id}
              dragState={dragState}
              isExpanded={visibleExpandedGroups[node.id] ?? false}
              level={0}
              node={node}
              pathname={pathname}
              onToggleGroup={toggleGroup}
              onGroupAction={openGroupAction}
              onFormAction={openFormAction}
              resolveExpanded={(groupId) => visibleExpandedGroups[groupId] ?? false}
            />
          ))}
        </div>

  );
}
