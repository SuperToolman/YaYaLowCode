"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@heroui/react";
import { Tree, type NodeRendererProps } from "react-arborist";
import { appActions, formActions } from "./permission-config";
import { Empty, PermissionCheckbox, StatusTag } from "./PermissionFeedback";
import type {
  App,
  NavigationItem,
  PermissionResource,
  PermissionState,
} from "./permission-types";
type PermissionTreeNode = {
  id: string;
  name: string;
  kind: "app" | "form";
  resourceId?: string;
  appId?: string;
  children?: PermissionTreeNode[];
};
export function AppTree({
  isReadOnly = false,
  apps,
  tree,
  state,
  onSelect,
  onSetAll,
  selected,
}: {
  isReadOnly?: boolean;
  apps: App[];
  tree: Record<string, NavigationItem[]>;
  state: (prefix: string, actions: readonly string[]) => PermissionState;
  onSelect: (value: PermissionResource) => void;
  onSetAll: (
    prefix: string,
    actions: readonly string[],
    checked: boolean,
  ) => void;
  selected: Pick<PermissionResource, "kind" | "id"> | null;
}) {
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeHeight, setTreeHeight] = useState(0);
  useEffect(() => {
    const container = treeContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) =>
      setTreeHeight(entry.contentRect.height),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const data = useMemo<PermissionTreeNode[]>(
    () =>
      apps.map((app) => ({
        id: `app:${app.id}`,
        name: app.name,
        kind: "app",
        resourceId: app.id,
        children: buildFormNodes(tree[app.id] ?? [], null, app.id),
      })),
    [apps, tree],
  );
  return (
    <Card className="h-full min-h-0 overflow-hidden">
      <Card.Header className="shrink-0">
        <Card.Title>应用结构</Card.Title>
      </Card.Header>
      <Card.Content
        ref={treeContainerRef}
        className="min-h-0 flex-1 basis-0 overflow-hidden"
      >
        {data.length ? (
          <Tree
            data={data}
            width="100%"
            height={treeHeight}
            indent={14}
            rowHeight={48}
            openByDefault={false}
            disableDrag
            disableDrop
          >
            {({ node, style }: NodeRendererProps<PermissionTreeNode>) => {
              const item = node.data;
              const prefix =
                item.kind === "app"
                  ? `app:${item.resourceId}`
                  : `form:${item.resourceId}`;
              const actions = item.kind === "app" ? appActions : formActions;
              const status = state(prefix, actions);
              const active =
                selected?.kind === item.kind && selected.id === item.resourceId;
              return (
                <div style={style}>
                  <div className="flex h-full items-center gap-1">
                    {node.isInternal ? (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={node.isOpen ? "收起" : "展开"}
                        onPress={() => node.toggle()}
                      >
                        <span
                          className={`transition-transform ${node.isOpen ? "rotate-90" : ""}`}
                        >
                          ›
                        </span>
                      </Button>
                    ) : (
                      <span aria-hidden className="size-8 shrink-0" />
                    )}
                    <PermissionCheckbox
                      isDisabled={isReadOnly}
                      label={`授予${item.name}全部权限`}
                      state={status}
                      onChange={(checked) => onSetAll(prefix, actions, checked)}
                    />
                    <Button
                      size="sm"
                      variant={active ? "secondary" : "ghost"}
                      aria-pressed={active}
                      onPress={() =>
                        onSelect({
                          kind: item.kind,
                          id: item.resourceId!,
                          label: item.name,
                        })
                      }
                      className="min-w-0 flex-1 justify-start"
                    >
                      <TreeIcon kind={item.kind} />
                      <span className="truncate">{item.name}</span>
                    </Button>
                    <StatusTag
                      value={
                        status === "all"
                          ? "全部"
                          : status === "partial"
                            ? "部分"
                            : "未授权"
                      }
                      tone={status}
                    />
                  </div>
                </div>
              );
            }}
          </Tree>
        ) : (
          <Empty text="暂无应用" />
        )}
      </Card.Content>
    </Card>
  );
}
function buildFormNodes(
  items: NavigationItem[],
  parentId: string | null,
  appId: string,
): PermissionTreeNode[] {
  return items
    .filter(
      (item) =>
        item.parentId === parentId &&
        (item.itemType === "group" || item.itemType === "form"),
    )
    .flatMap<PermissionTreeNode>((item): PermissionTreeNode[] =>
      item.itemType === "group"
        ? buildFormNodes(items, item.id, appId)
        : item.targetFormUuid
          ? [
              {
                id: `form:${item.targetFormUuid}`,
                name: item.title,
                kind: "form",
                resourceId: item.targetFormUuid,
                appId,
              },
            ]
          : [],
    );
}
function TreeIcon({ kind }: { kind: "app" | "form" }) {
  return kind === "app" ? (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 7.5h8M8 11.5h8M8 15.5h5" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 16h6" />
    </svg>
  );
}
