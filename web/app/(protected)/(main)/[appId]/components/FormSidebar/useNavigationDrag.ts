"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { PointerSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { reorderNavigationItem } from "@/features/application/api";
import { invalidateAppResources } from "@lib/app-resources";
import { canDropNavigationItem, expandGroupsFromItems } from "./navigation-utils";
import type { DragState, NavigationItem, NavigationDragData, NavigationDropData } from "./types";
import { NAVIGATION_DRAG_ACTIVATION } from "./navigation-interaction";

type Props = {
  routeAppId: string;
  items: NavigationItem[];
  setItems: Dispatch<SetStateAction<NavigationItem[]>>;
  setExpandedGroups: Dispatch<SetStateAction<Record<string, boolean>>>;
  startTransition: (callback: () => void) => void;
  setErrorMessage: Dispatch<SetStateAction<string>>;
};

export function useNavigationDrag({ routeAppId, items, setItems, setExpandedGroups, startTransition, setErrorMessage }: Props) {
  const [dragState, setDragState] = useState<DragState>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: NAVIGATION_DRAG_ACTIVATION,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as NavigationDragData | undefined;
    if (data?.kind === "navigation-item") {
      setDragState({ itemId: data.itemId });
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const dragData = event.active.data.current as
      | NavigationDragData
      | undefined;
    const dropData = event.over?.data.current as NavigationDropData | undefined;

    if (
      dragData?.kind !== "navigation-item" ||
      dropData?.kind !== "navigation-drop" ||
      !canDropNavigationItem(items, dragData.itemId, dropData.targetId)
    ) {
      if (dragData?.kind === "navigation-item") {
        setDragState({ itemId: dragData.itemId });
      }
      return;
    }

    setDragState({
      itemId: dragData.itemId,
      targetId: dropData.targetId,
      placement: dropData.placement,
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const dragData = event.active.data.current as
      | NavigationDragData
      | undefined;
    const dropData = event.over?.data.current as NavigationDropData | undefined;
    clearDragState();

    if (
      dragData?.kind !== "navigation-item" ||
      dropData?.kind !== "navigation-drop" ||
      !canDropNavigationItem(items, dragData.itemId, dropData.targetId)
    ) {
      return;
    }

    void (async () => {
      try {
        const { data, error } = await reorderNavigationItem({
          path: { appId: routeAppId },
          body: {
            item_id: dragData.itemId,
            target_item_id: dropData.targetId,
            placement: dropData.placement,
          },
          responseStyle: "fields",
        });
        if (!error && data?.code === 0 && data.data) {
          const nextItems = data.data as NavigationItem[];
          invalidateAppResources(routeAppId, ["navigation"]);
          startTransition(() => {
            setItems(nextItems);
            setExpandedGroups((current) =>
              expandGroupsFromItems(
                nextItems as unknown as NavigationItem[],
                current,
              ),
            );
          });
        } else {
          setErrorMessage(data?.message || "更新导航顺序失败。");
        }
      } catch {
        setErrorMessage("更新导航顺序失败，请稍后重试。");
      } finally {
        clearDragState();
      }
    })();
  }

  function clearDragState() {
    setDragState(null);
  }

  return { dragState, sensors, handleDragStart, handleDragOver, handleDragEnd, clearDragState };
}
