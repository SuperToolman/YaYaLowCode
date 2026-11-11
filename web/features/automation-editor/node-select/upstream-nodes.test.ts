import { describe, expect, it } from "vitest";
import { getUpstreamNodes } from "./upstream-nodes";

describe("上游节点选择", () => {
  const nodes = ["root", "create", "current", "later", "isolated"].map((id) => ({
    id, data: { kind: id === "create" ? "add-data" : "get-one" },
  }));
  const edges = [
    { source: "root", target: "create" }, { source: "create", target: "current" },
    { source: "current", target: "later" },
  ];
  it("只列出允许类型的前置节点，排除自身、后续和未连接节点", () => {
    expect(getUpstreamNodes(nodes, edges, "current", ["add-data"]).map((node) => node.id)).toEqual(["create"]);
    expect(getUpstreamNodes(nodes, edges, "current", ["get-one"]).map((node) => node.id)).toEqual(["root"]);
    expect(getUpstreamNodes(nodes, edges, null, ["get-one"])).toEqual([]);
    expect(getUpstreamNodes(nodes, edges, "current", ["get-one"], () => false)).toEqual([]);
  });
  it("分支汇合和循环输入不会重复或选中自身", () => {
    const connected = [...edges, { source: "root", target: "current" }, { source: "current", target: "root" }];
    expect(getUpstreamNodes(nodes, connected, "current", ["get-one", "add-data"]).map((node) => node.id)).toEqual(["root", "create"]);
  });
  it("前序节点已按节点删除来源时排除该来源，当前删除节点仍可选择自己的来源", () => {
    const deletion = { id: "delete", data: { kind: "delete-data", config: { deleteMode: "data-node", sourceNodeId: "create" } } };
    const graph = [...nodes, deletion];
    const links = [{ source: "root", target: "create" }, { source: "create", target: "delete" }, { source: "delete", target: "current" }];
    expect(getUpstreamNodes(graph, links, "current", ["get-one", "add-data"]).map((node) => node.id)).toEqual(["root"]);
    expect(getUpstreamNodes(graph, links, "delete", ["add-data"]).map((node) => node.id)).toEqual(["create"]);
    // 修改删除目标后，选项立即跟随图配置刷新。
    deletion.data.config.sourceNodeId = "root";
    expect(getUpstreamNodes(graph, links, "current", ["get-one", "add-data"]).map((node) => node.id)).toEqual(["create"]);
  });
  it("后续、未连接或按表单条件删除的节点，不推断为来源节点已被全部删除", () => {
    for (const config of [{ deleteMode: "data-node", sourceNodeId: "create" }, { deleteMode: "form", sourceNodeId: "create" }]) {
      const deletion = { id: "delete", data: { kind: "delete-data", config } };
      expect(getUpstreamNodes([...nodes, deletion], edges, "current", ["add-data"]).map((node) => node.id)).toEqual(["create"]);
    }
    const deletion = { id: "delete", data: { kind: "delete-data", config: { deleteMode: "form", sourceNodeId: "create" } } };
    expect(getUpstreamNodes([...nodes, deletion], [...edges, { source: "delete", target: "current" }], "current", ["add-data"]).map((node) => node.id)).toEqual(["create"]);
  });
});
