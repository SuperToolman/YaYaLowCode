"use client";

import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { Alert } from "@heroui/react";
import { Card } from "@heroui/react/card";
import type { FormSidebarProps } from "./types";
import { useFormSidebar } from "./useFormSidebar";
import { NavigationActions } from "./NavigationActions";
import { SidebarTree } from "./SidebarTree";
import { CreateGroupModal } from "./CreateGroupModal";
import { GroupActionModal } from "./GroupActionModal";
import { FormActionModal } from "./FormActionModal";
import { CreateFormModal } from "./CreateFormModal";

export function FormSidebar({ routeAppId }: FormSidebarProps) {
  const sidebar = useFormSidebar({ routeAppId });
  const {
    sensors,
    clearDragState,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    errorMessage,
    dragState,
    items,
  } = sidebar;
  return (
    <DndContext
      id={`form-sidebar-${routeAppId}`}
      collisionDetection={pointerWithin}
      sensors={sensors}
      onDragCancel={clearDragState}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
    >
      <Card className="flex h-full w-full min-h-0 flex-col overflow-hidden text-left">
        <NavigationActions {...sidebar} />
        {errorMessage ? (
          <Alert status="danger">
            <Alert.Content>
              <Alert.Description>{errorMessage}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <SidebarTree {...sidebar} />
        <CreateGroupModal {...sidebar} />
        <CreateFormModal {...sidebar} />
        <GroupActionModal {...sidebar} />
        <FormActionModal {...sidebar} />
      </Card>
      <DragOverlay dropAnimation={null}>
        {dragState ? (
          <div className="pointer-events-none max-w-52 truncate rounded-lg border border-[var(--color-primary)] bg-[var(--color-bg-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]">
            {items.find((item) => item.id === dragState.itemId)?.title ??
              "导航项"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
