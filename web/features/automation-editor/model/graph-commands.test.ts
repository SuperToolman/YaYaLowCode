import { describe, expect, it } from "vitest";
import { addGraphNode, applyNodeChanges, connectGraphEdge, removeGraphNode } from "./graph-commands";

describe("automation graph commands", () => {
  it("adds unique nodes and edges", () => {
    const node = { id: "a", position: { x: 0, y: 0 }, data: {}, type: "task" } as const;
    expect(addGraphNode([node], node)).toHaveLength(1);
    expect(connectGraphEdge([], { id: "e", source: "a", target: "b" })).toHaveLength(1);
  });
  it("removes connected edges with a node", () => {
    const result = removeGraphNode([{ id: "a" } as never, { id: "b" } as never], [{ id: "e", source: "a", target: "b" }], "a");
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("applies React Flow changes in the public changes-first order", () => {
    const node = { id: "a", position: { x: 0, y: 0 }, data: {}, type: "task" } as const;
    const next = applyNodeChanges(
      [{ id: "a", type: "position", position: { x: 40, y: 20 } }],
      [node],
    );
    expect(next[0]?.position).toEqual({ x: 40, y: 20 });
  });
});
