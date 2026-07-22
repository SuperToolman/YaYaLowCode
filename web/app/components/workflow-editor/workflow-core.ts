import type { Edge, Node } from "@xyflow/react";

export type WorkflowNodeData<Kind extends string, Config> = {
  kind: Kind;
  label: string;
  description: string;
  config: Config;
};

export type WorkflowGraphNode<Kind extends string, Config> = Node<
  WorkflowNodeData<Kind, Config>
>;

export type WorkflowGraphEdge<
  Data extends Record<string, unknown> = Record<string, never>,
> = Edge<Data>;

export type WorkflowNodeDefinition<Kind extends string> = {
  kind: Kind;
  label: string;
  description: string;
  group: string;
  isRoot?: boolean;
  validateConfig?: (config: unknown) => readonly WorkflowNodeConfigValidationIssue[];
};

export type WorkflowNodeConfigValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type WorkflowGraphValidationIssue = {
  code: "missing-root" | "duplicate-root" | "dangling-edge" | "cycle" | "isolated-node";
  edgeId?: string;
  nodeId?: string;
  severity: "error" | "warning";
};

export function createWorkflowNodeRegistry<const Definition extends WorkflowNodeDefinition<string>>(
  definitions: readonly Definition[],
) {
  return definitions;
}

export function groupWorkflowNodeDefinitions<Kind extends string>(
  definitions: readonly WorkflowNodeDefinition<Kind>[],
  options: { excludeKinds?: readonly Kind[] } = {},
) {
  const excluded = new Set(options.excludeKinds);
  const groups = new Map<string, WorkflowNodeDefinition<Kind>[]>();

  for (const definition of definitions) {
    if (excluded.has(definition.kind)) continue;
    const items = groups.get(definition.group) ?? [];
    items.push(definition);
    groups.set(definition.group, items);
  }

  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

export function serializeWorkflowGraph<
  Kind extends string,
  Config,
  EdgeData extends Record<string, unknown>,
>(
  nodes: readonly WorkflowGraphNode<Kind, Config>[],
  edges: readonly WorkflowGraphEdge<EdgeData>[],
) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

export function validateWorkflowGraph<
  Kind extends string,
  Config,
  EdgeData extends Record<string, unknown>,
>(
  nodes: readonly WorkflowGraphNode<Kind, Config>[],
  edges: readonly WorkflowGraphEdge<EdgeData>[],
  options: { rootKinds: readonly Kind[] },
): WorkflowGraphValidationIssue[] {
  const issues: WorkflowGraphValidationIssue[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rootNodes = nodes.filter((node) => options.rootKinds.includes(node.data.kind));

  if (rootNodes.length === 0) {
    issues.push({ code: "missing-root", severity: "error" });
  } else if (rootNodes.length > 1) {
    issues.push({ code: "duplicate-root", severity: "error" });
  }

  const adjacency = new Map<string, string[]>();
  const connectedNodeIds = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ code: "dangling-edge", edgeId: edge.id, severity: "error" });
      continue;
    }
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
    const targets = adjacency.get(edge.source) ?? [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const targetId of adjacency.get(nodeId) ?? []) {
      if (visit(targetId)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const node of nodes) {
    if (visit(node.id)) {
      issues.push({ code: "cycle", nodeId: node.id, severity: "error" });
      break;
    }
  }

  for (const node of nodes) {
    if (!options.rootKinds.includes(node.data.kind) && !connectedNodeIds.has(node.id)) {
      issues.push({ code: "isolated-node", nodeId: node.id, severity: "warning" });
    }
  }

  return issues;
}

export function validateWorkflowNodeConfigs<Kind extends string, Config>(
  nodes: readonly WorkflowGraphNode<Kind, Config>[],
  definitions: readonly WorkflowNodeDefinition<Kind>[],
) {
  const definitionsByKind = new Map(
    definitions.map((definition) => [definition.kind, definition]),
  );

  return nodes.flatMap((node) =>
    (definitionsByKind.get(node.data.kind)?.validateConfig?.(node.data.config) ?? []).map(
      (issue) => ({ ...issue, nodeId: node.id }),
    ),
  );
}
