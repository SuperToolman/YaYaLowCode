"use client";

import {
  Background,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnConnect,
  type OnConnectEnd,
} from "@xyflow/react";

type WorkflowCanvasProps<NodeType extends Node, EdgeType extends Edge> = {
  nodes: NodeType[];
  edges: EdgeType[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  onConnect: OnConnect;
  onConnectEnd: OnConnectEnd;
  onNodesChange: (changes: NodeChange<NodeType>[]) => void;
  onEdgesChange: (changes: EdgeChange<EdgeType>[]) => void;
  onNodeSelect: (node: NodeType) => void;
  onPaneClick: () => void;
};

export function WorkflowCanvas<NodeType extends Node, EdgeType extends Edge>({
  edges,
  edgeTypes,
  nodeTypes,
  nodes,
  onConnect,
  onConnectEnd,
  onEdgesChange,
  onNodeSelect,
  onNodesChange,
  onPaneClick,
}: WorkflowCanvasProps<NodeType, EdgeType>) {
  return (
    <ReactFlow<NodeType, EdgeType>
      fitView
      nodes={nodes}
      edges={edges}
      edgeTypes={edgeTypes}
      nodeTypes={nodeTypes}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onEdgesChange={onEdgesChange}
      onNodesChange={onNodesChange}
      onNodeClick={(_event, node) => onNodeSelect(node)}
      onPaneClick={onPaneClick}
      defaultEdgeOptions={{
        type: "insertable",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "var(--color-primary)", strokeWidth: 1.4 },
      }}
      proOptions={{ hideAttribution: true }}
      className="h-full w-full"
    >
      <MiniMap
        pannable
        zoomable
        position="bottom-left"
        nodeBorderRadius={8}
        maskColor="var(--color-flow-mask)"
      />
      <Background gap={18} size={1} color="var(--color-flow-grid)" />
    </ReactFlow>
  );
}
