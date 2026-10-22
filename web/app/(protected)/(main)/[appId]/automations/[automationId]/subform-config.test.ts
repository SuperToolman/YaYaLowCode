import { describe, expect, it } from "vitest";
import { defaultNodeTemplate, getSchemaForNodeTarget, normalizeAddDataConfig, normalizeFormSchema, normalizeWorkflowNodes, serializeWorkflow, type WorkflowNode } from "./automation-editor-model";

describe("子表新增配置", () => {
  const node: WorkflowNode = {
    id: "add", type: "workflow", position: { x: 0, y: 0 },
    data: { ...defaultNodeTemplate("add-data"), config: {
      targetMode: "subtable", targetFormUuid: "parent", parentDataNodeId: "query", subformFieldId: "items",
      rows: [{ id: "row", fieldId: "name", valueType: "field", sourceFieldKey: "query:name" }],
    } },
  };
  const schema = normalizeFormSchema({ formUuid: "parent", fields: [
    { id: "title", type: "singleLineText" },
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
  it("失效子表不提供目标字段", () => {
    const stale = { ...node, data: { ...node.data, config: { ...normalizeAddDataConfig(node.data.config), subformFieldId: "deleted" } } };
    expect(getSchemaForNodeTarget(stale, { parent: schema })).toBeUndefined();
  });
});
