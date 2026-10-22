"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { Dropdown } from "@heroui/react";
import {
  Copy,
  PencilToSquare,
  ArrowDownToSquare,
  TrashBin,
} from "@gravity-ui/icons";

import type {
  SidebarNode,
  GroupAction,
  FormAction,
  NavigationDragData,
  DragState,
} from "./types";
import {
  getSidebarNodeIcon,
  getSidebarNodeIconColor,
} from "./navigation-icons";
import {
  NavigationItemDropZones,
  EmptyGroupDropZone,
} from "./NavigationDropZones";
import { NAVIGATION_DRAG_DELAY_MS } from "./navigation-interaction";

export function SidebarTreeItem({
  dragState,
  isExpanded,
  level,
  node,
  pathname,
  onToggleGroup,
  onGroupAction,
  onFormAction,
  resolveExpanded,
}: {
  dragState: DragState;
  isExpanded: boolean;
  level: number;
  node: SidebarNode;
  pathname: string;
  onToggleGroup: (groupId: string) => void;
  onGroupAction: (node: SidebarNode, action: GroupAction) => void;
  onFormAction: (node: SidebarNode, action: FormAction) => void;
  resolveExpanded: (groupId: string) => boolean;
}) {
  const isActive = Boolean(node.href && pathname === node.href);
  const isDropTarget = dragState?.targetId === node.id;
  const showChildren = node.itemType !== "group" || isExpanded;
  const paddingLeft = 10 + level * 14;
  const nodeIcon = getSidebarNodeIcon(
    node.itemType,
    node.pathSlug,
    isExpanded,
    node.formType,
  );
  const nodeIconColor = getSidebarNodeIconColor(node.itemType, node.formType);
  const isDetailForm = node.itemType === "form" && node.formType === "detail";
  const isDraggable = node.itemType !== "system" && !isDetailForm;
  const { attributes, isDragging, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: `navigation-item:${node.id}`,
    data: {
      kind: "navigation-item",
      itemId: node.id,
    } satisfies NavigationDragData,
    disabled: !isDraggable,
  });

  const [isMenuOpen, setMenuOpen] = useState(false);
  const draggedRef = useRef(false);
  const pointerPressRef = useRef<{ startedAt: number; menuWasOpen: boolean; held: boolean; duration?: number } | null>(null);
  useDndMonitor({
    onDragStart({ active }) {
      if (active.id === `navigation-item:${node.id}`) {
        draggedRef.current = true;
        setMenuOpen(false);
      }
    },
  });

  return (
    <div>
      <div
        ref={setNodeRef}
        className={[
          "group/sidebar-item relative rounded-[var(--radius)] border-0 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-text-primary)]",
          isDragging ? "opacity-35" : "",
          isActive
            ? "bg-[var(--color-control-selected)] text-[var(--color-text-primary)]"
            : "",
          isDropTarget && dragState?.placement === "inside"
            ? "bg-[var(--color-primary-soft)] outline outline-1 outline-dashed outline-[var(--color-primary)]"
            : "",
          isDropTarget && dragState?.placement === "before"
            ? "shadow-[inset_0_3px_0_0_var(--color-primary)]"
            : "",
          isDropTarget && dragState?.placement === "after"
            ? "shadow-[inset_0_-3px_0_0_var(--color-primary)]"
            : "",
        ].join(" ")}
      >
        {dragState &&
        dragState.itemId !== node.id &&
        node.itemType !== "system" &&
        !isDetailForm ? (
          <NavigationItemDropZones node={node} />
        ) : null}
        {node.itemType === "group" ? (
          <button
            type="button"
            onClick={() => onToggleGroup(node.id)}
            className="flex w-full items-center gap-2.5 py-2 text-left"
            style={{ paddingLeft }}
          >
            <span
              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${nodeIconColor}`}
            >
              {nodeIcon}
            </span>
            <span className="min-w-0 truncate text-xs font-medium">
              {node.name}
            </span>
          </button>
        ) : (
          <Link
            href={node.href ?? "#"}
            className="flex w-full items-center gap-2.5 py-2 text-left"
            style={{ paddingLeft }}
          >
            <span
              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${nodeIconColor}`}
            >
              {nodeIcon}
            </span>
            <span className="min-w-0 truncate text-xs font-medium">
              {node.name}
            </span>
          </Link>
        )}
        {node.itemType === "group" ||
        node.itemType === "form" ||
        isDraggable ? (
          <div className="pointer-events-none absolute right-1 top-1/2 z-30 flex -translate-y-1/2 items-center rounded-[var(--radius)] bg-[var(--color-bg-surface)] p-0.5 text-[var(--color-text-disabled)] opacity-0 transition-opacity group-hover/sidebar-item:pointer-events-auto group-hover/sidebar-item:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            {node.itemType === "group" || node.itemType === "form" ? (
              <Dropdown
                isOpen={isMenuOpen && !isDragging}
                onOpenChange={(open) => {
                  // HeroUI requests opening on press-down; pointer clicks are
                  // resolved on release so they can be distinguished from drags.
                  if (pointerPressRef.current?.held) return;
                  if (!open || (!isDragging && !draggedRef.current)) setMenuOpen(open);
                }}
              >
                <Dropdown.Trigger
                  {...attributes}
                  ref={setActivatorNodeRef}
                  aria-label={node.name + (isDraggable ? " 操作（点击打开菜单，长按拖拽）" : " 操作")}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || !event.isPrimary) return;
                    draggedRef.current = false;
                    pointerPressRef.current = { startedAt: performance.now(), menuWasOpen: isMenuOpen, held: true };
                    listeners?.onPointerDown?.(event);
                    event.stopPropagation();
                  }}
                  onPointerUp={() => {
                    const press = pointerPressRef.current;
                    if (!press) return;
                    press.held = false;
                    press.duration = performance.now() - press.startedAt;
                    if (isDraggable && press.duration >= NAVIGATION_DRAG_DELAY_MS) draggedRef.current = true;
                  }}
                  onPointerCancel={() => {
                    pointerPressRef.current = null;
                    draggedRef.current = true;
                  }}
                  onKeyDown={(event) => {
                    pointerPressRef.current = null;
                    draggedRef.current = false;
                    listeners?.onKeyDown?.(event);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    const press = pointerPressRef.current;
                    if (!press) return;
                    press.held = false;
                    if (!isDragging && !draggedRef.current && (!isDraggable || (press.duration ?? performance.now() - press.startedAt) < NAVIGATION_DRAG_DELAY_MS)) {
                      setMenuOpen(!press.menuWasOpen);
                    }
                  }}
                  className="flex h-7 w-7 touch-none cursor-grab items-center justify-center rounded-[var(--radius)] text-[10px] tracking-[-2px] hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-text-primary)] active:cursor-grabbing"
                >
                  <span aria-hidden="true">⋮⋮</span>
                </Dropdown.Trigger>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    aria-label={node.name + (node.itemType === "group" ? " 分组操作" : " 表单操作")}
                    onAction={(key) => node.itemType === "group"
                      ? onGroupAction(node, String(key) as GroupAction)
                      : onFormAction(node, String(key) as FormAction)}
                  >
                    <Dropdown.Item id="rename"><PencilToSquare />修改名称</Dropdown.Item>
                    <Dropdown.Item id="copy"><Copy />复制</Dropdown.Item>
                    <Dropdown.Item id="move"><ArrowDownToSquare />移动到</Dropdown.Item>
                    <Dropdown.Item id="delete" className="text-[var(--color-danger)]"><TrashBin />删除</Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            ) : isDraggable ? (
              <button
                ref={setActivatorNodeRef}
                type="button"
                aria-label={"拖拽 " + node.name}
                {...attributes}
                {...listeners}
                className="flex h-7 w-7 touch-none cursor-grab items-center justify-center text-[10px] tracking-[-2px]"
              >⋮⋮</button>
            ) : null}
          </div>
        ) : null}
      </div>
      {node.itemType === "group" &&
      (showChildren || (node.children.length === 0 && dragState)) ? (
        <div
          className={[
            "mb-1 rounded-lg",
            dragState?.targetId === node.id && dragState.placement === "inside"
              ? "bg-[var(--color-primary-soft)]"
              : "",
          ].join(" ")}
        >
          {node.children.length > 0 ? (
            node.children.map((child) => (
              <SidebarTreeItem
                key={child.id}
                dragState={dragState}
                isExpanded={resolveExpanded(child.id)}
                level={level + 1}
                node={child}
                pathname={pathname}
                onToggleGroup={onToggleGroup}
                onGroupAction={onGroupAction}
                onFormAction={onFormAction}
                resolveExpanded={resolveExpanded}
              />
            ))
          ) : dragState && dragState.itemId !== node.id ? (
            <EmptyGroupDropZone groupId={node.id} />
          ) : null}
        </div>
      ) : null}
      {node.itemType !== "group" && node.children.length > 0 && showChildren
        ? node.children.map((child) => (
            <SidebarTreeItem
              key={child.id}
              dragState={dragState}
              isExpanded={resolveExpanded(child.id)}
              level={level + 1}
              node={child}
              pathname={pathname}
              onToggleGroup={onToggleGroup}
              onGroupAction={onGroupAction}
              onFormAction={onFormAction}
              resolveExpanded={resolveExpanded}
            />
          ))
        : null}
    </div>
  );
}
