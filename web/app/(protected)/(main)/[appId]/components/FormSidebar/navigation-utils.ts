import type { NavigationItem, SidebarNode } from "./types";

export function canDropNavigationItem(items: NavigationItem[], itemId: string, targetId: string) {
  const target = items.find((item) => item.id === targetId);
  return Boolean(target && target.itemType !== "system" && itemId !== targetId && !isNavigationDescendant(items, targetId, itemId));
}

export function isNavigationDescendant(items: NavigationItem[], candidateId: string, ancestorId: string) {
  let current = items.find((item) => item.id === candidateId);
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.id);
    current = items.find((item) => item.id === current?.parentId);
  }
  return false;
}

export function buildNavigationTree(routeAppId: string, items: NavigationItem[]) {
  const legacyTaskSlugs = new Set(["todo", "processed", "created", "copied"]);
  const visibleItems = items.filter((item) => !(item.itemType === "system" && legacyTaskSlugs.has(item.pathSlug)));
  if (!visibleItems.some((item) => item.itemType === "system" && item.pathSlug === "tasks")) {
    visibleItems.unshift({ id: "system-tasks", itemType: "system", title: "任务", pathSlug: "tasks", sortOrder: -1, isDefaultEntry: false, parentId: null });
  }
  const nodeMap = new Map<string, SidebarNode>();
  for (const item of visibleItems) {
    const routeId = item.targetFormUuid ?? item.pathSlug;
    nodeMap.set(item.id, {
      id: item.id,
      name: item.title,
      href: item.itemType === "group" ? undefined : `/${routeAppId}/${routeId}${item.itemType === "system" && routeId === "tasks" ? `?appId=${encodeURIComponent(routeAppId)}` : ""}`,
      itemType: item.itemType,
      parentId: item.parentId ?? null,
      sortOrder: item.sortOrder,
      targetFormUuid: item.targetFormUuid,
      pathSlug: item.pathSlug,
      formType: item.formType,
      children: [],
    });
  }
  const roots: SidebarNode[] = [];
  for (const item of visibleItems) {
    const node = nodeMap.get(item.id);
    if (!node) continue;
    if (item.parentId && nodeMap.has(item.parentId)) nodeMap.get(item.parentId)?.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (nodes: SidebarNode[]) => {
    nodes.sort((left, right) => left.sortOrder - right.sortOrder);
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

export function expandGroupsFromItems(items: NavigationItem[], current: Record<string, boolean>) {
  const next = { ...current };
  for (const item of items) if (item.itemType === "group" && next[item.id] === undefined) next[item.id] = false;
  return next;
}

export function flattenGroups(nodes: SidebarNode[], level = 0): Array<{ id: string; label: string }> {
  const result: Array<{ id: string; label: string }> = [];
  for (const node of nodes) {
    if (node.itemType === "group") {
      result.push({ id: node.id, label: `${"　".repeat(level)}${node.name}` });
      result.push(...flattenGroups(node.children, level + 1));
    }
  }
  return result;
}

export function applyFormTypes(navigation: NavigationItem[], forms: Array<{ id: string; formType?: string }>): NavigationItem[] {
  const typesById = new Map(forms.map((form) => [form.id, form.formType === "workflow" ? "workflow" : form.formType === "defined" ? "defined" : form.formType === "detail" ? "detail" : "normal"] as const));
  return navigation.map((item) => ({ ...item, formType: item.targetFormUuid ? typesById.get(item.targetFormUuid) : undefined }));
}

