import type { Edge, Node, OnEdgesChange, OnNodesChange } from "@xyflow/react";

export function addGraphNode<T extends Node>(nodes: T[], node: T): T[] { return nodes.some((item) => item.id === node.id) ? nodes : [...nodes, node]; }
export function removeGraphNode<T extends Node>(nodes: T[], edges: Edge[], id: string) { return { nodes: nodes.filter((node) => node.id !== id), edges: edges.filter((edge) => edge.source !== id && edge.target !== id) }; }
export function connectGraphEdge(edges: Edge[], edge: Edge): Edge[] { return edges.some((item) => item.source === edge.source && item.target === edge.target && item.sourceHandle === edge.sourceHandle) ? edges : [...edges, edge]; }
export function applyNodeChanges<T extends Node>(changes: Parameters<OnNodesChange<T>>[0], nodes: T[]): T[] { return changes.reduce((current, change) => { if (!("id" in change)) return current; return change.type === "remove" ? current.filter((node) => node.id !== change.id) : current.map((node) => node.id === change.id && change.type === "position" ? { ...node, position: change.position ?? node.position } : node); }, nodes); }
export function applyEdgeChanges(changes: Parameters<OnEdgesChange>[0], edges: Edge[]): Edge[] { return changes.reduce((current, change) => change.type === "remove" ? current.filter((edge) => edge.id !== change.id) : current, edges); }
