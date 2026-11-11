import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultNodeTemplate, normalizeConditionConfig } from "../model/automation-editor-model";
import type { FlowState, WorkflowNode } from "../model/editor-types";
import { useNodeConfigActions } from "./use-node-config-actions";

afterEach(cleanup);

function setup(kind: "condition" | "get-one", selected = true) {
  const node: WorkflowNode = {
    id: "node", type: "workflow", position: { x: 0, y: 0 }, data: defaultNodeTemplate(kind),
  };
  const ensureFormSchema = vi.fn(async () => undefined);
  const flowState: FlowState = {
    name: "流程", description: "", status: "enabled", flowType: "trigger",
    triggerFormUuid: "source", triggerEvents: [], triggerConfig: {},
  };
  return {
    ...renderHook(() => {
      const [nodes, setNodes] = useState([node]);
      const actions = useNodeConfigActions({
        selectedNodeId: selected ? node.id : null, selectedNode: selected ? nodes[0] : null,
        nodes, setNodes, edges: [], formSchemas: {}, flowState, ensureFormSchema,
        handleTriggerConfigChange: vi.fn(),
      });
      return { nodes, actions };
    }), ensureFormSchema, node,
  };
}

it("changes the selected node without mutating the original graph", () => {
  const { result, node } = setup("get-one");
  act(() => result.current.actions.handleGetNodeFormChange("target"));
  expect(result.current.nodes[0].data.config).toMatchObject({ formUuid: "target", rules: [] });
  expect(node.data.config).not.toHaveProperty("formUuid", "target");
});

it("loads the selected target schema and ignores configuration writes without selection", () => {
  const { result, ensureFormSchema } = setup("get-one");
  act(() => result.current.actions.handleGetNodeFormChange("target"));
  expect(ensureFormSchema).toHaveBeenCalledWith("target");
  const empty = setup("get-one", false);
  const before = empty.result.current.nodes;
  act(() => empty.result.current.actions.handleNodeLabelChange("label", "不应保存"));
  expect(empty.result.current.nodes).toBe(before);
});

it("keeps the otherwise branch at the end when reordering exclusive branches", () => {
  const { result } = setup("condition");
  const before = normalizeConditionConfig(result.current.nodes[0].data.config).branches!;
  const fallback = before.find(branch => branch.entryMode === "otherwise")!;
  act(() => result.current.actions.handleMoveConditionBranch(fallback.id, "up"));
  const after = normalizeConditionConfig(result.current.nodes[0].data.config).branches!;
  expect(after.map(branch => branch.id)).toEqual(before.map(branch => branch.id));
});
