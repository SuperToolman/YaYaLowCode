import { describe, expect, it } from "vitest";
import { defaultNodeTemplate, normalizeActionConfig, normalizeFormSchema, normalizeWorkflowNodes, serializeWorkflow, validateDeleteNodeConfiguration, buildSubformParentOptions, buildGetSourceOptions, buildQueryNodeOptions } from "./automation-editor-model";
import type { FlowState, WorkflowNode } from "@/features/automation-editor/model/editor-types";

const flow = { triggerFormUuid: "customers", flowType: "trigger" } as FlowState;
const source: WorkflowNode = { id: "source", type: "workflow", position: { x: 0, y: 0 }, data: { ...defaultNodeTemplate("add-data"), config: { targetFormUuid: "customers", targetMode: "form" } } };
const makeDelete = (config: unknown): WorkflowNode => ({ id: "delete", type: "workflow", position: { x: 0, y: 0 }, data: { ...defaultNodeTemplate("delete-data"), config: normalizeActionConfig(config) } });
const schemas = { customers: normalizeFormSchema({ formUuid: "customers", fields: [{ id: "status", type: "singleLineText", label: "状态" }] }) };
const edges = [{ id: "e", source: "source", target: "delete" }];

describe("删除节点配置", () => {
  it("公共数据来源选项排除被前序删除节点删除的来源", () => {
    const query: WorkflowNode = { ...source, id: "query", data: { ...defaultNodeTemplate("get-many"), config: { sourceMode: "form", formUuid: "customers" } } };
    const deletion = makeDelete({ deleteMode: "data-node", sourceNodeId: "query" });
    const links = [{ id: "a", source: "query", target: "delete" }, { id: "b", source: "delete", target: "next" }];
    const nodes = [query,deletion];
    expect(buildSubformParentOptions(nodes, links, "next")).toEqual([]);
    expect(buildGetSourceOptions(nodes, links, "next")).toEqual([]);
    expect(buildQueryNodeOptions(nodes, links, "next")).toEqual([]);
    expect(buildSubformParentOptions(nodes, links, "delete").map((option) => option.id)).toEqual(["query"]);
    const next = { ...deletion, id: "next" };
    expect(validateDeleteNodeConfiguration(next, [...nodes,next], links, schemas, flow)).toBeTruthy();
  });
  it("默认要求配置条件，旧表达式不会被静默丢弃", () => {
    const node = makeDelete({ targetFormUuid: "customers" });
    expect(validateDeleteNodeConfiguration(node, [source, node], edges, schemas, flow)).toBeTruthy();
    const old = makeDelete({ targetFormUuid: "customers", matchRule: "status == old" });
    expect(validateDeleteNodeConfiguration(old, [old], [], schemas, flow)).toContain("旧删除表达式");
    const all = makeDelete({ targetFormUuid: "customers", filterMode: "all" });
    expect(validateDeleteNodeConfiguration(all, [all], [], schemas, flow)).toBeUndefined();
  });
  it("条件规则保存回读保留结构并校验失效字段", () => {
    const config = { targetFormUuid: "customers", deleteMode: "form", filterMode: "rules", rules: [{ id: "r", fieldKey: "status", operator: "eq", rawValue: "old" }] };
    const node = makeDelete(config);
    expect(validateDeleteNodeConfiguration(node, [node], [], schemas, flow)).toBeUndefined();
    const saved = serializeWorkflow([node], []);
    expect(normalizeActionConfig(saved.nodes[0].data.config)).toMatchObject(config);
    const invalid = makeDelete({ ...config, rules: [{ ...config.rules[0], fieldKey: "deleted" }] });
    expect(validateDeleteNodeConfiguration(invalid, [invalid], [], schemas, flow)).toBeTruthy();
  });
  it("节点删除限定上游主表记录节点，排除后继和失效来源", () => {
    const node = makeDelete({ deleteMode: "data-node", sourceNodeId: "source", targetFormUuid: "wrong-cache" });
    expect(validateDeleteNodeConfiguration(node, [source,node], edges, schemas, flow)).toBeUndefined();
    expect(validateDeleteNodeConfiguration(node, [source,node], [], schemas, flow)).toBeTruthy();
    const child = { ...source, data: { ...source.data, config: { targetMode: "subtable", targetFormUuid: "customers" } } };
    expect(validateDeleteNodeConfiguration(node, [child,node], edges, schemas, flow)).toBeTruthy();
  });
  it("节点删除保存回读保留模式和初始触发节点来源", () => {
    const trigger: WorkflowNode = { id: "trigger-1", type: "workflow", position: { x: 0, y: 0 }, data: defaultNodeTemplate("trigger") };
    const node = makeDelete({ deleteMode: "data-node", sourceNodeId: "trigger-1", targetFormUuid: "customers" });
    const serialized = serializeWorkflow([trigger, node], [{ id: "e", source: "trigger-1", target: "delete" }]);
    const restored = normalizeWorkflowNodes(serialized.nodes).find((item) => item.id === "delete");
    expect(normalizeActionConfig(restored?.data.config)).toMatchObject({ deleteMode: "data-node", sourceNodeId: "trigger-1" });
  });
  it("连接器撤销请求配置保存回读完整", () => {
    const compensationRequest = {
      method: "DELETE",
      url: "https://example.com/hooks/{{trigger-1.id}}",
      headersText: '{"Authorization":"Bearer token"}',
      bodyTemplate: '{"undo":true}',
    };
    const node = {
      ...defaultNodeTemplate("http-request"),
      config: normalizeActionConfig({ compensationRequest }),
    };
    expect(normalizeActionConfig(node.config).compensationRequest).toEqual(compensationRequest);
  });
});
