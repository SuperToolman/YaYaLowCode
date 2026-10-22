"use client";

import { useDroppable } from "@dnd-kit/core";
import type { SidebarNode, NavigationDropData } from "./types";

export function NavigationItemDropZones({ node }: { node: SidebarNode }) {
  return (
    <>
      <NavigationDropZone
        id={`navigation-drop:${node.id}:before`}
        targetId={node.id}
        placement="before"
        className={node.itemType === "group" ? "top-0 h-1/4" : "top-0 h-1/2"}
      />
      {node.itemType === "group" ? (
        <NavigationDropZone
          id={`navigation-drop:${node.id}:inside`}
          targetId={node.id}
          placement="inside"
          className="top-1/4 h-1/2"
        />
      ) : null}
      <NavigationDropZone
        id={`navigation-drop:${node.id}:after`}
        targetId={node.id}
        placement="after"
        className={
          node.itemType === "group" ? "bottom-0 h-1/4" : "bottom-0 h-1/2"
        }
      />
    </>
  );
}

function NavigationDropZone({
  className,
  id,
  placement,
  targetId,
}: {
  className: string;
  id: string;
  placement: NavigationDropData["placement"];
  targetId: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: {
      kind: "navigation-drop",
      targetId,
      placement,
    } satisfies NavigationDropData,
  });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-0 z-20 ${className} ${isOver ? "bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]" : ""}`}
    />
  );
}

export function EmptyGroupDropZone({ groupId }: { groupId: string }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `navigation-drop:${groupId}:empty-inside`,
    data: {
      kind: "navigation-drop",
      targetId: groupId,
      placement: "inside",
    } satisfies NavigationDropData,
  });

  return (
    <div
      ref={setNodeRef}
      className={`mb-2 flex h-8 w-full min-w-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-[var(--radius)] border border-dashed px-2 text-xs ${isOver ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}
    >
      <span className="truncate">拖拽到这里放入分组</span>
    </div>
  );
}
