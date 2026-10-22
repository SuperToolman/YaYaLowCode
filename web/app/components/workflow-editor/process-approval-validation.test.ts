import { describe, expect, it } from "vitest";
import { hasReachableProcessApproval, type WorkflowGraphNode } from "./workflow-core";

const node = (id: string, kind: string, config: unknown = {}): WorkflowGraphNode<string, unknown> => ({
  id, position: { x: 0, y: 0 }, data: { kind, config, label: id, description: "" },
});
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, sourceHandle });
const nodes = [node("trigger-1", "trigger"), node("data", "get-one"), node("approval", "approval"), node("leaf", "get-one")];

describe("审批流程保存的审批人可达性", () => {
  it("拒绝没有审批节点或审批节点孤立的流程", () => {
    expect(hasReachableProcessApproval([nodes[0]], [])).toBe(false);
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "data")])).toBe(false);
  });
  it("接受直接及经过数据节点可抵达的审批人", () => {
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "approval")])).toBe(true);
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "data"), edge("data", "approval")])).toBe(true);
  });
  it("不能穿过结束节点，但普通节点的第二条出口也可抵达审批人", () => {
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "leaf")])).toBe(false);
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "leaf"), edge("trigger-1", "approval")])).toBe(true);
  });
  it.each(["condition", "parallel-condition"])("检查 %s 所有配置出口，包括否则出口，排除已删除的出口", (kind) => {
    const graph = [...nodes, node("condition", kind, { branches: [{ id: "yes" }, { id: "otherwise" }] })];
    const edges = [edge("trigger-1", "condition"), edge("condition", "leaf", "condition-branch:yes")];
    expect(hasReachableProcessApproval(graph, [...edges, edge("condition", "approval", "condition-branch:otherwise")])).toBe(true);
    expect(hasReachableProcessApproval(graph, [...edges, edge("condition", "approval", "condition-branch:removed")])).toBe(false);
  });
  it("循环及失效目标不会导致检查卡死或误判", () => {
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "data"), edge("data", "data")])).toBe(false);
    expect(hasReachableProcessApproval(nodes, [edge("trigger-1", "missing"), edge("missing", "approval")])).toBe(false);
  });
});
