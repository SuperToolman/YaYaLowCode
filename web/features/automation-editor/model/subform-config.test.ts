import { describe, expect, it } from "vitest";
import { buildSubformParentOptions, buildGetSourceOptions, getSourceFormUuid } from "./automation-editor-model";
import { defaultNodeTemplate, getNodeMappingTargetFields, getSchemaForNodeTarget, normalizeAddDataConfig, normalizeFormSchema, normalizeWorkflowNodes, serializeWorkflow, syncRequiredRows } from "./automation-editor-model";
import type { WorkflowNode } from "@/features/automation-editor/model/editor-types";

describe("子表新增配置", () => {
  it("可以从上游主表新增节点解析父表，但不能选择新增子表行节点", () => {
    const create: WorkflowNode = { id: "create", type: "workflow", position: { x: 0, y: 0 },
      data: { ...defaultNodeTemplate("add-data"), config: { targetMode: "form", targetFormUuid: "parent" } } };
    const child = { ...create, id: "child", data: { ...create.data, config: { targetMode: "subtable", targetFormUuid: "parent" } } };
    const edges = [{ id: "a", source: "create", target: "child" }, { id: "b", source: "child", target: "current" }];
    expect(buildSubformParentOptions([create, child], edges, "current").map((item) => item.id)).toEqual(["create"]);
    expect(buildGetSourceOptions([create, child], edges, "current")).toEqual([]);
    expect(getSourceFormUuid(create, [create, child], "")).toBe("parent");
    expect(getSourceFormUuid(child, [create, child], "")).toBe("");
  });
  const node: WorkflowNode = {
    id: "add", type: "workflow", position: { x: 0, y: 0 },
    data: { ...defaultNodeTemplate("add-data"), config: {
      targetMode: "subtable", targetFormUuid: "parent", parentDataNodeId: "query", subformFieldId: "items",
      rows: [{ id: "row", fieldId: "name", valueType: "field", sourceFieldKey: "query:name" }],
    } },
  };
  const schema = normalizeFormSchema({ formUuid: "parent", fields: [
    { id: "title", type: "singleLineText", props: { isRequired: true } },
    { id: "items", type: "subform" },
    { id: "name", type: "singleLineText", parentGroupId: "items", props: { isRequired: true } },
    { id: "other", type: "subform" },
    { id: "amount", type: "number", parentGroupId: "other" },
  ] });
  it("保存回读保留来源节点、子表字段和字段引用", () => {
    const saved = serializeWorkflow([node], []);
    const config = normalizeAddDataConfig(normalizeWorkflowNodes(saved.nodes)[0].data.config);
    expect(config.parentDataNodeId).toBe("query");
    expect(config.subformFieldId).toBe("items");
    expect(config.rows?.[0].sourceFieldKey).toBe("query:name");
  });
  it("目标字段只包含所选子表的字段及必填配置", () => {
    const target = getSchemaForNodeTarget(node, { parent: schema });
    expect(target?.fields.map((field) => field.id)).toEqual(["name"]);
    expect(target?.fields[0].isRequired).toBe(true);
  });
  it("表单新增映射字段排除子表字段及其必填项", () => {
    const formNode: WorkflowNode = {
      ...node,
      data: { ...node.data, config: { targetMode: "form", targetFormUuid: "parent", rows: [] } },
    };
    const fields = getNodeMappingTargetFields(formNode, { parent: schema });
    expect(fields.map((field) => field.id)).toEqual(["title"]);
    expect(syncRequiredRows([], fields).map((row) => row.fieldId)).toEqual(["title"]);
  });
  it("失效子表不提供目标字段", () => {
    const stale = { ...node, data: { ...node.data, config: { ...normalizeAddDataConfig(node.data.config), subformFieldId: "deleted" } } };
    expect(getSchemaForNodeTarget(stale, { parent: schema })).toBeUndefined();
  });
});
