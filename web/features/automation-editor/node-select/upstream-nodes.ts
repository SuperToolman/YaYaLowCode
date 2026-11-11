export type SelectableAutomationNode = {
  id: string;
  data: { kind: string; label?: string; description?: string; config?: unknown };
};
export type AutomationConnection = { source: string; target: string };

function nodeConfig(node: SelectableAutomationNode): Record<string, unknown> {
  const config = node.data.config;
  return config && typeof config === "object" ? config as Record<string, unknown> : {};
}

/** 只失效明确按节点删除的来源；按表单条件删除无法静态确定记录交集。 */
export function getDeletedSourceNodeIds(
  nodes: readonly SelectableAutomationNode[],
  upstreamIds: ReadonlySet<string>,
  currentNodeId: string,
): Set<string> {
  const deleted = new Set<string>();
  for (const node of nodes) {
    if (node.id === currentNodeId || !upstreamIds.has(node.id) || node.data.kind !== "delete-data") continue;
    const config = nodeConfig(node);
    if (config.deleteMode === "data-node" && typeof config.sourceNodeId === "string") deleted.add(config.sourceNodeId);
  }
  return deleted;
}

/** 图上的所有前置节点，排除自身、后继和未连接节点；循环数据也会终止。 */
export function getUpstreamNodes<T extends SelectableAutomationNode>(
  nodes: readonly T[],
  edges: readonly AutomationConnection[],
  currentNodeId: string | null,
  allowedKinds: readonly T["data"]["kind"][],
  isSelectable?: (node: T) => boolean,
): T[] {
  if (!currentNodeId) return [];
  const visited = new Set([currentNodeId]);
  const pending = [currentNodeId];
  while (pending.length) {
    const target = pending.pop();
    for (const edge of edges) {
      if (edge.target !== target || visited.has(edge.source)) continue;
      visited.add(edge.source);
      pending.push(edge.source);
    }
  }
  const deleted = getDeletedSourceNodeIds(nodes, visited, currentNodeId);
  return nodes.filter((node) => node.id !== currentNodeId && visited.has(node.id) && !deleted.has(node.id)
    && allowedKinds.includes(node.data.kind) && (!isSelectable || isSelectable(node)));
}
