"use client";

import { SidebarTreeItem } from "./SidebarTreeItem";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<ReturnType<typeof useFormSidebar>, "tree" | "dragState" | "expandedGroups" | "pathname" | "toggleGroup" | "openGroupAction" | "openFormAction">;

export function SidebarTree({ tree, dragState, expandedGroups, pathname, toggleGroup, openGroupAction, openFormAction }: Props) {
  return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tree.map((node) => (
            <SidebarTreeItem
              key={node.id}
              dragState={dragState}
              isExpanded={expandedGroups[node.id] ?? false}
              level={0}
              node={node}
              pathname={pathname}
              onToggleGroup={toggleGroup}
              onGroupAction={openGroupAction}
              onFormAction={openFormAction}
              resolveExpanded={(groupId) => expandedGroups[groupId] ?? false}
            />
          ))}
        </div>

  );
}
