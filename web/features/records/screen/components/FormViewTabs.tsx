"use client";

import { Tabs } from "@heroui/react";
import { MyTabsListContainer } from "@/shared/ui/MyTabsListContainer";
import type { FormView } from "@/features/records/screen/model/use-form-views";

type ViewTab = Pick<FormView, "id" | "name" | "isDefault">;

export function FormViewTabs({
  views,
  activeViewId,
  onActivate,
}: {
  views: readonly ViewTab[];
  activeViewId: string;
  onActivate: (viewId: string) => void;
}) {
  const items = views.map((view) => ({
    id: view.id,
    label: view.isDefault ? "全部数据" : view.name,
  }));
  // React Aria's shared indicator snapshots include the old viewport position
  // and tab width. Adding/removing/renaming views resizes this right-aligned
  // group, so discard those snapshots when the collection changes. Selection
  // alone keeps the same scope and retains the normal switching animation.
  const collectionKey = JSON.stringify(items);

  return (
    <Tabs
      key={collectionKey}
      className="min-w-0 max-w-full"
      selectedKey={`view:${activeViewId}`}
      onSelectionChange={(key) => onActivate(String(key).replace(/^view:/, ""))}
    >
      <MyTabsListContainer className="max-w-full">
        <Tabs.List aria-label="数据视图" className="w-max min-w-max flex-nowrap">
          {items.map((item) => (
            <Tabs.Tab
              key={item.id}
              id={`view:${item.id}`}
              className="w-auto min-w-0 shrink-0 whitespace-nowrap"
            >
              {item.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </MyTabsListContainer>
    </Tabs>
  );
}
