import { describe, expect, it } from "vitest";
import { evaluateBinding, newBinding, validateButtonConditions } from "./bindings";
import { emptyDraft } from "./model";
import type { FormRecord } from "@/features/records/types";
const record: FormRecord = { id: "source", formUuid: "source-form", schemaVersion: 1, data: { name: "yes", comparison: "yes", empty: [] }, createdBy: "张三", updatedBy: "张三", createdAt: "2026-10-13", updatedAt: "2026-10-13" };
const fields = ["name", "comparison", "empty"].map(key => ({ key, label: key, fieldType: "singleLineText", options: [] }));
describe("表单按钮条件", () => {
  it("视图绑定只引用按钮，所有视图共享按钮条件", () => { const a = newBinding("a"), b = newBinding("a"); const button = emptyDraft(); button.availability.mode = "conditions"; button.availability.rules = [{ id: "r", fieldKey: "name", operator: "eq", rawValue: "yes" }]; expect(a).toEqual(b); expect(evaluateBinding(button, record)).toBe(true); expect(evaluateBinding(button, { ...record, data: { name: "no" } })).toBe(false); });
  it("条件校验拒绝失效引用、空条件和循环", () => { const availability = { mode: "conditions" as const, rules: [] as import("@/features/automation-editor/condition-rules").BranchRule[] }; expect(validateButtonConditions(availability, fields)).toContain("完整"); availability.rules = [{ id: "r", fieldKey: "target-only", operator: "hasValue" }]; expect(validateButtonConditions(availability, fields)).toContain("失效"); availability.rules = [{ id: "g", isGroup: true, parentId: "r" }, { id: "r", parentId: "g", fieldKey: "name", operator: "hasValue" }]; expect(validateButtonConditions(availability, fields)).toContain("结构"); });
  it("系统字段可用且空数组不视为有值", () => { const button = emptyDraft(); button.availability = { mode: "conditions", rules: [{ id: "r", fieldKey: "instanceId", rawValue: "source" }, { id: "e", fieldKey: "empty", operator: "noValue" }] }; expect(evaluateBinding(button, record)).toBe(true); });
});
