"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Dropdown,
  Input,
  SearchField,
  Select,
  ListBox,
} from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { Card } from "@heroui/react/card";
import {
  AddIcon,
  FolderIcon,
  FolderOpenIcon,
  FormIcon,
  LinkIcon,
  ListIcon,
} from "../../../components/app-icons";
import type { AppForm } from "../../../lib/apps";

type FormSidebarProps = {
  initialForms: AppForm[];
  routeAppId: string;
};

type FormSummary = {
  id: string;
  name: string;
  category: string;
  count?: number | null;
  status: string;
};

type NavigationItem = {
  id: string;
  itemType: "form" | "system" | "group" | "link";
  targetFormUuid?: string | null;
  title: string;
  pathSlug: string;
  sortOrder: number;
  isDefaultEntry: boolean;
  parentId?: string | null;
};

type SidebarNode = {
  id: string;
  name: string;
  href?: string;
  itemType: NavigationItem["itemType"];
  parentId?: string | null;
  sortOrder: number;
  targetFormUuid?: string | null;
  children: SidebarNode[];
};

type ApiEnvelope<T> = {
  code: number;
  data: T | null;
  message: string;
  time: string;
};

const ROOT_PARENT_VALUE = "__root__";

export function FormSidebar({ initialForms, routeAppId }: FormSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<NavigationItem[]>(() =>
    buildStaticNavigationItems(routeAppId, initialForms),
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupParentId, setGroupParentId] = useState(ROOT_PARENT_VALUE);
  const [dragState, setDragState] = useState<{
    itemId: string;
    targetId?: string;
    placement?: "before" | "after" | "inside";
  } | null>(null);
  const draggingItemIdRef = useRef<string | null>(null);
  const dragTargetRef = useRef<{
    itemId: string;
    targetId?: string;
    placement?: "before" | "after" | "inside";
  } | null>(null);

  const tree = useMemo(() => buildNavigationTree(routeAppId, items), [routeAppId, items]);
  const groupOptions = useMemo(() => flattenGroups(tree), [tree]);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/apps/${routeAppId}/navigation`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ApiEnvelope<NavigationItem[]>;

        if (!cancelled && payload.code === 0 && payload.data) {
          const nextItems = payload.data;
          setItems(nextItems);
          setExpandedGroups((current) => expandGroupsFromItems(nextItems, current));
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("导航加载失败，当前展示本地数据。");
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [routeAppId]);

  function refreshNavigation() {
    startTransition(async () => {
      const response = await fetch(`/api/apps/${routeAppId}/navigation`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiEnvelope<NavigationItem[]>;

      if (payload.code === 0 && payload.data) {
        const nextItems = payload.data;
        setItems(nextItems);
        setExpandedGroups((current) => expandGroupsFromItems(nextItems, current));
      }
    });
  }

  function handleCreateForm() {
    setErrorMessage("");

    startTransition(async () => {
      const response = await fetch(`/api/apps/${routeAppId}/forms`, {
        method: "POST",
      });
      const payload = (await response.json()) as ApiEnvelope<FormSummary>;

      if (payload.code !== 0 || !payload.data) {
        setErrorMessage(payload.message || "创建表单失败。");
        return;
      }

      refreshNavigation();
      router.push(`/designer/${payload.data.id}?appId=${routeAppId}`);
    });
  }

  function handleCreateGroup() {
    const nextTitle = groupName.trim();

    if (!nextTitle) {
      return;
    }

    setErrorMessage("");

    startTransition(async () => {
      const response = await fetch(`/api/apps/${routeAppId}/navigation/groups`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: nextTitle,
          parent_id: groupParentId === ROOT_PARENT_VALUE ? null : groupParentId,
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<NavigationItem>;

      if (payload.code !== 0) {
        setErrorMessage(payload.message || "创建分组失败。");
        return;
      }

      setGroupName("");
      setGroupParentId(ROOT_PARENT_VALUE);
      setCreateGroupOpen(false);
      refreshNavigation();
    });
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }

  function handleDragStart(itemId: string) {
    const nextState = {
      itemId,
    };

    draggingItemIdRef.current = itemId;
    dragTargetRef.current = nextState;
    setDragState(nextState);
  }

  function handleDragOver(
    event: React.DragEvent<HTMLDivElement>,
    item: SidebarNode,
  ) {
    const draggingItemId = draggingItemIdRef.current;

    if (
      !draggingItemId ||
      draggingItemId === item.id ||
      item.itemType === "system" ||
      isNavigationDescendant(items, item.id, draggingItemId)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const placement =
      item.itemType === "group" && ratio > 0.25 && ratio < 0.75
        ? "inside"
        : ratio < 0.5
          ? "before"
          : "after";

    const current = dragTargetRef.current;
    if (
      current?.itemId === draggingItemId &&
      current.targetId === item.id &&
      current.placement === placement
    ) {
      return;
    }

    const nextState: NonNullable<typeof dragState> = {
      itemId: draggingItemId,
      targetId: item.id,
      placement,
    };

    dragTargetRef.current = nextState;
    setDragState(nextState);
  }

  function handleDrop() {
    const nextDragState = dragTargetRef.current;

    if (!nextDragState?.targetId || !nextDragState.placement) {
      clearDragState();
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/apps/${routeAppId}/navigation`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            item_id: nextDragState.itemId,
            target_item_id: nextDragState.targetId,
            placement: nextDragState.placement,
          }),
        });
        const payload = (await response.json()) as ApiEnvelope<NavigationItem[]>;

        if (payload.code === 0 && payload.data) {
          const nextItems = payload.data;
          setItems(nextItems);
          setExpandedGroups((current) => expandGroupsFromItems(nextItems, current));
        } else {
          setErrorMessage(payload.message || "更新导航顺序失败。");
        }
      } catch {
        setErrorMessage("更新导航顺序失败，请稍后重试。");
      } finally {
        clearDragState();
      }
    });
  }

  function handleDropInsideGroup(groupId: string) {
    const draggingItemId = draggingItemIdRef.current;

    if (
      !draggingItemId ||
      draggingItemId === groupId ||
      isNavigationDescendant(items, groupId, draggingItemId)
    ) {
      clearDragState();
      return;
    }

    const nextDragState: NonNullable<typeof dragState> = {
      itemId: draggingItemId,
      targetId: groupId,
      placement: "inside",
    };

    dragTargetRef.current = nextDragState;
    setDragState(nextDragState);
    handleDrop();
  }

  function handleDragOverInsideGroup(
    event: React.DragEvent<HTMLDivElement>,
    groupId: string,
  ) {
    const draggingItemId = draggingItemIdRef.current;

    if (
      !draggingItemId ||
      draggingItemId === groupId ||
      isNavigationDescendant(items, groupId, draggingItemId)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    const current = dragTargetRef.current;
    if (
      current?.itemId === draggingItemId &&
      current.targetId === groupId &&
      current.placement === "inside"
    ) {
      return;
    }

    const nextState: NonNullable<typeof dragState> = {
      itemId: draggingItemId,
      targetId: groupId,
      placement: "inside",
    };

    dragTargetRef.current = nextState;
    setDragState(nextState);
  }

  function clearDragState() {
    draggingItemIdRef.current = null;
    dragTargetRef.current = null;
    setDragState(null);
  }

  return (
    <Card className="flex h-full w-full flex-col items-stretch justify-start self-start overflow-hidden rounded-xl border-0 bg-transparent p-3 text-left text-[var(--text-primary)] shadow-none">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <SearchField aria-label="搜索表单" name="search" className="min-w-0 flex-1">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索表单..." />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Dropdown>
          <Dropdown.Trigger>
            <span
              aria-label="新增导航项"
              className={[
                "inline-flex h-10 w-10 min-w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--panel-border)] bg-[var(--panel-background)] text-[var(--accent-strong)] transition-colors",
                isPending ? "opacity-60" : "hover:bg-[var(--surface-soft)]",
              ].join(" ")}
            >
              <AddIcon />
            </span>
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="新增导航项"
              onAction={(key) => {
                if (key === "form") {
                  handleCreateForm();
                }
                if (key === "group") {
                  setCreateGroupOpen(true);
                }
              }}
            >
              <Dropdown.Item id="form">创建表单</Dropdown.Item>
              <Dropdown.Item id="group">创建分组</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>

      {errorMessage ? (
        <Alert className="mb-3" status="danger">
          <Alert.Content>
            <Alert.Description>{errorMessage}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tree.map((node) => (
          <SidebarTreeItem
            key={node.id}
            dragState={dragState}
            isExpanded={expandedGroups[node.id] ?? true}
            level={0}
            node={node}
            pathname={pathname}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onDragOverInsideGroup={handleDragOverInsideGroup}
            onDropInsideGroup={handleDropInsideGroup}
            onDragEnd={clearDragState}
            onToggleGroup={toggleGroup}
            resolveExpanded={(groupId) => expandedGroups[groupId] ?? true}
          />
        ))}
      </div>

      <Modal
        isOpen={createGroupOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setCreateGroupOpen(false);
          }
        }}
      >
        <Modal.Backdrop className="bg-black/30" isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog className="theme-menu-surface rounded-2xl shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
              <Modal.Header className="border-b border-[var(--panel-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--text-primary)]">
                  创建分组
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4 px-5 py-4">
                <Input
                  aria-label="分组名称"
                  placeholder="请输入分组名称"
                  value={groupName}
                  onChange={(event) => setGroupName(event.currentTarget.value)}
                />
                <Select
                  selectedKey={groupParentId}
                  onSelectionChange={(key) => setGroupParentId(String(key ?? ROOT_PARENT_VALUE))}
                >
                  <Select.Trigger>
                    <Select.Value>
                      {groupParentId === ROOT_PARENT_VALUE
                        ? "顶级分组"
                        : groupOptions.find((item) => item.id === groupParentId)?.label ??
                          "顶级分组"}
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id={ROOT_PARENT_VALUE} textValue="顶级分组">
                        顶级分组
                      </ListBox.Item>
                      {groupOptions.map((item) => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                          {item.label}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--panel-border)] px-5 py-3">
                <Button
                  variant="ghost"
                  onClick={() => setCreateGroupOpen(false)}
                  className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
                >
                  取消
                </Button>
                <Button
                  onClick={handleCreateGroup}
                  isDisabled={isPending || !groupName.trim()}
                  className="h-10 rounded-lg bg-[var(--accent-strong)] px-4 text-white"
                >
                  创建
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}

function SidebarTreeItem({
  dragState,
  isExpanded,
  level,
  node,
  pathname,
  onDragOver,
  onDragStart,
  onDrop,
  onDragOverInsideGroup,
  onDropInsideGroup,
  onDragEnd,
  onToggleGroup,
  resolveExpanded,
}: {
  dragState: {
    itemId: string;
    targetId?: string;
    placement?: "before" | "after" | "inside";
  } | null;
  isExpanded: boolean;
  level: number;
  node: SidebarNode;
  pathname: string;
  onDragOver: (event: React.DragEvent<HTMLDivElement>, item: SidebarNode) => void;
  onDragStart: (itemId: string) => void;
  onDrop: () => void;
  onDragOverInsideGroup: (event: React.DragEvent<HTMLDivElement>, groupId: string) => void;
  onDropInsideGroup: (groupId: string) => void;
  onDragEnd: () => void;
  onToggleGroup: (groupId: string) => void;
  resolveExpanded: (groupId: string) => boolean;
}) {
  const isActive = Boolean(node.href && pathname === node.href);
  const isDropTarget = dragState?.targetId === node.id;
  const showChildren = node.itemType !== "group" || isExpanded;
  const paddingLeft = 10 + level * 14;
  const nodeIcon = getSidebarNodeIcon(node.itemType, isExpanded);
  const nodeIconColor = getSidebarNodeIconColor(node.itemType);

  return (
    <div>
      <div
        draggable={node.itemType !== "system"}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          onDragStart(node.id);
        }}
        onDragOver={(event) => onDragOver(event, node)}
        onDrop={(event) => {
          event.preventDefault();
          onDrop();
        }}
        onDragEnd={onDragEnd}
        className={[
          "mb-0.5 rounded-lg border transition-colors",
          isActive
            ? "border-[var(--panel-border)] bg-[var(--surface-soft)] text-[var(--text-primary)]"
            : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--panel-background-soft)]",
          isDropTarget && dragState?.placement === "inside"
            ? "border-dashed border-[var(--accent-strong)]"
            : "",
          isDropTarget && dragState?.placement === "before"
            ? "shadow-[inset_0_3px_0_0_var(--accent-strong)]"
            : "",
          isDropTarget && dragState?.placement === "after"
            ? "shadow-[inset_0_-3px_0_0_var(--accent-strong)]"
            : "",
        ].join(" ")}
      >
        {node.itemType === "group" ? (
          <button
            type="button"
            onClick={() => onToggleGroup(node.id)}
            className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
            style={{ paddingLeft }}
          >
            <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${nodeIconColor}`}>
              {nodeIcon}
            </span>
            <span className="truncate text-xs font-medium">{node.name}</span>
          </button>
        ) : (
          <Link
            href={node.href ?? "#"}
            className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
            style={{ paddingLeft }}
          >
            <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${nodeIconColor}`}>
              {nodeIcon}
            </span>
            <span className="truncate text-xs font-medium">{node.name}</span>
          </Link>
        )}
      </div>
      {node.itemType === "group" && showChildren ? (
        <div
          className={[
            "mb-1 rounded-lg",
            dragState?.targetId === node.id && dragState.placement === "inside"
              ? "bg-[var(--accent-soft)]"
              : "",
          ].join(" ")}
          onDragOver={(event) => onDragOverInsideGroup(event, node.id)}
          onDrop={(event) => {
            event.preventDefault();
            handleGroupContentDrop(event, node.id, onDropInsideGroup);
          }}
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
                onDragOver={onDragOver}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onDragOverInsideGroup={onDragOverInsideGroup}
                onDropInsideGroup={onDropInsideGroup}
                onDragEnd={onDragEnd}
                onToggleGroup={onToggleGroup}
                resolveExpanded={resolveExpanded}
              />
            ))
          ) : dragState ? (
            <div
              className="mb-2 ml-12 flex h-8 items-center rounded-lg border border-dashed border-[var(--panel-border)] px-3 text-xs text-[var(--text-muted)]"
              style={{ marginRight: 4 }}
            >
              拖拽到这里放入分组
            </div>
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
              onDragOver={onDragOver}
              onDragStart={onDragStart}
              onDrop={onDrop}
              onDragOverInsideGroup={onDragOverInsideGroup}
              onDropInsideGroup={onDropInsideGroup}
              onDragEnd={onDragEnd}
              onToggleGroup={onToggleGroup}
              resolveExpanded={resolveExpanded}
            />
          ))
        : null}
    </div>
  );
}

function handleGroupContentDrop(
  event: React.DragEvent<HTMLDivElement>,
  groupId: string,
  onDropInsideGroup: (groupId: string) => void,
) {
  event.stopPropagation();
  onDropInsideGroup(groupId);
}

function isNavigationDescendant(
  items: NavigationItem[],
  candidateId: string,
  ancestorId: string,
) {
  let current = items.find((item) => item.id === candidateId);
  const visited = new Set<string>();

  while (current?.parentId && !visited.has(current.id)) {
    if (current.parentId === ancestorId) {
      return true;
    }

    visited.add(current.id);
    current = items.find((item) => item.id === current?.parentId);
  }

  return false;
}

function buildNavigationTree(routeAppId: string, items: NavigationItem[]) {
  const nodeMap = new Map<string, SidebarNode>();

  for (const item of items) {
    const routeId = item.targetFormUuid ?? item.pathSlug;
    nodeMap.set(item.id, {
      id: item.id,
      name: item.title,
      href: item.itemType === "group" ? undefined : `/${routeAppId}/${routeId}`,
      itemType: item.itemType,
      parentId: item.parentId ?? null,
      sortOrder: item.sortOrder,
      targetFormUuid: item.targetFormUuid,
      children: [],
    });
  }

  const roots: SidebarNode[] = [];

  for (const item of items) {
    const node = nodeMap.get(item.id);
    if (!node) {
      continue;
    }

    if (item.parentId && nodeMap.has(item.parentId)) {
      nodeMap.get(item.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: SidebarNode[]) => {
    nodes.sort((left, right) => left.sortOrder - right.sortOrder);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(roots);
  return roots;
}

function getSidebarNodeIcon(
  itemType: NavigationItem["itemType"],
  isExpanded = false,
) {
  switch (itemType) {
    case "group":
      return isExpanded ? <FolderOpenIcon /> : <FolderIcon />;
    case "system":
      return <ListIcon />;
    case "link":
      return <LinkIcon />;
    case "form":
    default:
      return <FormIcon />;
  }
}

function getSidebarNodeIconColor(itemType: NavigationItem["itemType"]) {
  switch (itemType) {
    case "group":
      return "text-[var(--nav-group-icon)]";
    case "form":
      return "text-[var(--nav-form-icon)]";
    case "link":
      return "text-[var(--nav-link-icon)]";
    case "system":
    default:
      return "text-[var(--text-muted)]";
  }
}

function expandGroupsFromItems(
  items: NavigationItem[],
  current: Record<string, boolean>,
) {
  const next = { ...current };
  for (const item of items) {
    if (item.itemType === "group" && next[item.id] === undefined) {
      next[item.id] = true;
    }
  }
  return next;
}

function flattenGroups(nodes: SidebarNode[], level = 0): Array<{ id: string; label: string }> {
  const result: Array<{ id: string; label: string }> = [];

  for (const node of nodes) {
    if (node.itemType === "group") {
      result.push({
        id: node.id,
        label: `${"　".repeat(level)}${node.name}`,
      });
      result.push(...flattenGroups(node.children, level + 1));
    }
  }

  return result;
}

function buildStaticNavigationItems(routeAppId: string, forms: AppForm[]): NavigationItem[] {
  return [
    {
      id: `system-${routeAppId}-todo`,
      itemType: "system",
      title: "待我处理",
      pathSlug: "todo",
      sortOrder: 0,
      isDefaultEntry: true,
      parentId: null,
    },
    {
      id: `system-${routeAppId}-processed`,
      itemType: "system",
      title: "我处理的",
      pathSlug: "processed",
      sortOrder: 1,
      isDefaultEntry: false,
      parentId: null,
    },
    {
      id: `system-${routeAppId}-created`,
      itemType: "system",
      title: "我创建的",
      pathSlug: "created",
      sortOrder: 2,
      isDefaultEntry: false,
      parentId: null,
    },
    {
      id: `system-${routeAppId}-copied`,
      itemType: "system",
      title: "抄送我的",
      pathSlug: "copied",
      sortOrder: 3,
      isDefaultEntry: false,
      parentId: null,
    },
    ...forms.map((form, index) => ({
      id: form.id,
      itemType: "form" as const,
      title: form.name,
      targetFormUuid: form.id,
      pathSlug: `form-${index + 1}`,
      sortOrder: 100 + index,
      isDefaultEntry: false,
      parentId: null,
    })),
  ];
}
