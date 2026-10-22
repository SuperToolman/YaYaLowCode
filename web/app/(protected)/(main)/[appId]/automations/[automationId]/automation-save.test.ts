import { describe, expect, it } from "vitest";
import { automationSaveErrorMessage, automationSaveMetadata } from "./automation-save";
import type { FlowState } from "./automation-editor-model";

const flow: FlowState = {
  flowType: "process", name: "客户审批", description: "说明", status: "enabled",
  triggerFormUuid: "form-1", triggerEvents: ["form_submit"], triggerConfig: {},
};

describe("自动化保存请求和错误反馈", () => {
  it("审批流程请求不携带名称，保留提交事件和其他配置", () => {
    const request = JSON.parse(JSON.stringify(automationSaveMetadata(flow, "默认名称")));
    expect(request).not.toHaveProperty("name");
    expect(request).toMatchObject({ triggerEvents: ["form_submit"], triggerFormUuid: "form-1", status: "enabled", description: "说明" });
  });
  it("普通自动化继续保存名称和兜底名称", () => {
    expect(automationSaveMetadata({ ...flow, flowType: "trigger" }, "默认名称").name).toBe("客户审批");
    expect(automationSaveMetadata({ ...flow, flowType: "trigger", name: " " }, "默认名称").name).toBe("默认名称");
  });
  it("保留后端 400 的具体校验原因，兼容异常和未知响应", () => {
    const message = "审批流程必须至少存在一个从表单提交节点可抵达的审批人节点，无法保存。";
    expect(automationSaveErrorMessage({ code: 400, message, data: null })).toBe(message);
    expect(automationSaveErrorMessage(new Error("网络连接失败"))).toBe("网络连接失败");
    expect(automationSaveErrorMessage(undefined)).toContain("保存自动化编排失败");
  });
});
