import { describe, expect, it } from "vitest";
import { buildTriggerNodeData, nodeSummary, type FlowState, type NodeSummaryContext, type WorkflowNodeData } from "./automation-editor-model";

const context: NodeSummaryContext = {
  members: [{ id: "member-1", displayName: "张三", status: "active", sourceType: "local" }],
  roles: [{ id: "role-1", name: "财务", status: "active", sourceType: "local" }],
};
const summary = (kind: WorkflowNodeData["kind"], config: WorkflowNodeData["config"]) =>
  nodeSummary({ kind, label: "节点", description: "", config }, context);

describe("人工节点摘要", () => {
  it("显示审批人员和多人审批规则", () => {
    expect(summary("approval", { assigneeIds: ["member-1"], approvalMode: "any" })).toBe("审批人: 张三\n任一同意");
    expect(summary("approval", { assigneeMode: "self" })).toBe("审批人: 发起人本人\n全部同意");
  });
  it("按当前范围显示角色，不使用残留成员配置", () => {
    expect(summary("approval", { assigneeMode: "roles", roleIds: ["role-1"], assigneeIds: ["member-1"] })).toBe("审批人: 财务\n全部同意");
    expect(summary("copy", { recipientMode: "roles", roleIds: ["role-1"] })).toBe("抄送角色: 财务\n通知后自动继续");
  });
  it("显示执行人和必填字段数量", () => {
    expect(summary("executor", { assigneeIds: ["member-1"], requiredFieldIds: ["field-1"] })).toBe("执行人: 张三\n完成前需补填 1 个字段");
  });
  it.each(["approval", "copy", "executor"] as const)("%s 不显示表单配置提示", (kind) => {
    expect(summary(kind, {})).not.toContain("目标表单");
    expect(summary(kind, {})).not.toBe("");
  });
  it("更新来源是查询节点时提示查询来源", () => {
    expect(summary("update-data", { updateMode: "data-node" })).toBe("未配置查询数据源节点");
  });
});

describe("根节点摘要", () => {
  const flowState: FlowState = {
    flowType: "trigger", name: "测试", description: "", status: "paused",
    triggerFormUuid: "", triggerEvents: ["after_create"], triggerConfig: {},
  };
  it("创建事件不显示字段变更提示", () => {
    expect(nodeSummary(buildTriggerNodeData(flowState, []), { flowState })).toBe("所选表单事件发生时执行");
  });
  it("审批流程显示提交启动", () => {
    const process = { ...flowState, flowType: "process" as const };
    expect(nodeSummary(buildTriggerNodeData(process, []), { flowState: process })).toBe("表单提交后启动审批流程");
  });
  it("编辑事件显示指定字段名称", () => {
    const edit: FlowState = { ...flowState, triggerEvents: ["after_update"], triggerConfig: { changedFieldMode: "specific", changedFieldId: "amount" } };
    expect(nodeSummary(buildTriggerNodeData(edit, []), {
      flowState: edit, fields: [{ id: "amount", label: "金额", type: "number", isRequired: false, options: [] }],
    })).toBe("编辑时指定字段变更: 金额");
  });
});
