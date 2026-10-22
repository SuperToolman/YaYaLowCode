import { describe, expect, it } from "vitest";
import { automationWorkflowNodeRegistry, processWorkflowNodeRegistry } from "../components/AutomationWorkflowNodeRegistry";
import { workflowDraftFields, collectSchemaTargets, defaultNodeTemplate, normalizeNodeConfigByKind, normalizeNodeKind, type FlowState, type WorkflowNode } from "./automation-editor-model";
import { syncRequiredRows } from "@/features/automation-editor/field-mapping";

describe("发起审批（仅填写流程表单）", () => {
  it("可供普通/按钮自动化和流程自动化插入，但不替代审批人节点", () => {
    for (const registry of [automationWorkflowNodeRegistry, processWorkflowNodeRegistry]) expect(registry.some((node) => node.kind === "initiate-approval")).toBe(true);
    expect(automationWorkflowNodeRegistry.some((node) => node.kind === "approval")).toBe(false);
    expect(processWorkflowNodeRegistry.some((node) => node.kind === "approval")).toBe(true);
  });
  it("保留跨应用目标、字段映射和发起人配置", () => {
    const config = { targetAppId: "other-app", targetFormUuid: "workflow-form", initiatorMode: "field", initiatorFieldId: "owner", rows: [{ id: "r1", fieldId: "title", valueType: "field", sourceFieldKey: "trigger-1:title" }] };
    expect(normalizeNodeKind("initiate-approval")).toBe("initiate-approval");
    expect(normalizeNodeConfigByKind("initiate-approval", config)).toMatchObject(config);
    const node = { id: "draft", type: "workflow", position: { x: 0, y: 0 }, data: { ...defaultNodeTemplate("initiate-approval"), config } } as WorkflowNode;
    expect(collectSchemaTargets({ triggerFormUuid: "source" } as FlowState, [node])).toContain("workflow-form");
  });
  it("包含普通分组的成员字段，排除子表内部字段", () => {
    const descriptor = (id: string, type: string, parentGroupId?: string) => ({ id, type, label: id, parentGroupId, isRequired: false, options: [] });
    const fields = workflowDraftFields({ formUuid: "f", formName: "流程表单", fields: [descriptor("group", "groupContainer"), descriptor("owner", "member", "group"), descriptor("sub", "subform"), descriptor("child", "member", "sub")] });
    expect(fields.map((field) => field.id)).toEqual(["owner"]);
  });
  it("补齐必填映射并保留已配置值，不重复添加", () => {
    const fields = [{ id: "title", label: "标题", type: "singleLineText", isRequired: true, options: [] }, { id: "note", label: "备注", type: "singleLineText", isRequired: false, options: [] }];
    const rows = syncRequiredRows([], fields);
    expect(rows.map((row) => row.fieldId)).toEqual(["title"]);
    rows[0].rawValue = "申请";
    expect(syncRequiredRows(rows, fields)).toEqual(rows);
  });
});
