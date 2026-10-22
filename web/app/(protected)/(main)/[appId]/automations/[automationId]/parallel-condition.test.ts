import { GearBranches } from "@gravity-ui/icons";
import { describe, expect, it } from "vitest";
import { defaultNodeTemplate, defaultSourceHandleForNode, normalizeWorkflowNodes, serializeWorkflow, type WorkflowNode } from "./automation-editor-model";
import { automationWorkflowNodeRegistry, processWorkflowNodeRegistry } from "../components/AutomationWorkflowNodeRegistry";

describe("并行条件分支配置协议", () => {
  it("在集成自动化菜单注册，并复用条件配置校验", () => {
    const definition = automationWorkflowNodeRegistry.find((item) => item.kind === "parallel-condition")!;
    expect(definition.icon).toBe(GearBranches);
    expect(definition.label).toBe("并行条件分支");
    expect(definition.validateConfig({ branches: [] })[0].severity).toBe("error");
    expect(definition.validateConfig(defaultNodeTemplate("parallel-condition").config)).toEqual([]);
    expect(processWorkflowNodeRegistry.map((item) => item.kind)).toContain("parallel-condition");
  });
  it("保存、回读保留分支规则和出口，且不保存优先级", () => {
    const node: WorkflowNode = { id: "parallel", type: "workflow", position: { x: 0, y: 0 }, data: defaultNodeTemplate("parallel-condition") };
    const handle = defaultSourceHandleForNode(node);
    const graph = serializeWorkflow([node], [{ id: "edge", source: node.id, target: "next", sourceHandle: handle }]);
    const config = graph.nodes[0].data.config as { branches: Record<string, unknown>[] };
    expect(config.branches).toHaveLength(2);
    expect(config.branches.every((branch) => !("priority" in branch))).toBe(true);
    const restored = normalizeWorkflowNodes(graph.nodes)[0];
    expect(restored.data.kind).toBe("parallel-condition");
    expect(defaultSourceHandleForNode(restored)).toBe(handle);
    expect(serializeWorkflow([restored], []).nodes).toEqual(graph.nodes);
    const exclusive: WorkflowNode = { ...node, data: defaultNodeTemplate("condition") };
    const original = serializeWorkflow([exclusive], []).nodes[0].data.config as { branches: Record<string, unknown>[] };
    expect(original.branches[0].priority).toBe(1);
  });
});
