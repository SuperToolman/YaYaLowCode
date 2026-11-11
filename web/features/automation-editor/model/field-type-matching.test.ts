import { describe, expect, it } from "vitest";
import { buildDataNodeFieldChoices, buildRecordFieldChoices, buildSourceFieldChoices, defaultNodeTemplate, fieldTypeMatches, normalizeFormSchema } from "./automation-editor-model";
import type { FlowState, WorkflowNode } from "@/features/automation-editor/model/editor-types";

const association = "associationFormField";
const region = { associationFormId: "regions" };
const schema = normalizeFormSchema({ formUuid: "customers", fields: [
  { id: "region", label: "销售区域", type: association, props: region },
] });
const node = (id: string, kind: "trigger" | "get-many"): WorkflowNode => ({
  id, type: "workflow", position: { x: 0, y: 0 },
  data: { ...defaultNodeTemplate(kind), config: { sourceMode: "form", formUuid: "customers" } },
});

describe("映射字段类型兼容性", () => {
  it("关联字段只接受同一关联表的字段", () => {
    expect(fieldTypeMatches(association, association, region, region)).toBe(true);
    expect(fieldTypeMatches(association, association, region, { associationFormId: "employees" })).toBe(false);
    expect(fieldTypeMatches(association, association)).toBe(false);
    expect(fieldTypeMatches(association, association, region, {})).toBe(false);
    expect(fieldTypeMatches("singleLineText", association, undefined, region)).toBe(false);
    expect(fieldTypeMatches(association, "singleLineText", region)).toBe(false);
  });

  it("复杂值和未知类型不再兜底匹配文本，日期与日期范围分开", () => {
    for (const type of ["countryCity", "attachment", "imageUpload", "richText", "cascader", "subform", "customType"]) {
      expect(fieldTypeMatches(type, "singleLineText")).toBe(false);
      expect(fieldTypeMatches("singleLineText", type)).toBe(false);
      expect(fieldTypeMatches(type, type)).toBe(true);
    }
    expect(fieldTypeMatches("attachment", "imageUpload")).toBe(false);
    expect(fieldTypeMatches("date", "dateRange")).toBe(false);
    expect(fieldTypeMatches("singleLineText", "multiLineText")).toBe(true);
    expect(fieldTypeMatches("select", "radio")).toBe(true);
    expect(fieldTypeMatches("checkbox", "multiSelect")).toBe(true);
    expect(fieldTypeMatches("number", "singleLineText")).toBe(false);
  });

  it("普通来源、上游来源和批量来源都保留关联元数据", () => {
    expect(buildRecordFieldChoices(schema.fields)[0].props).toEqual(region);
    const trigger = node("trigger", "trigger");
    const query = node("query", "get-many");
    const upstream = buildSourceFieldChoices({
      currentNodeId: "target", edges: [{ id: "edge", source: "trigger", target: "target" }],
      formSchemas: { customers: schema }, nodes: [trigger],
      flowState: { triggerFormUuid: "customers", flowType: "trigger" } as FlowState,
    });
    expect(upstream.find((field) => field.key === "trigger:region")?.props).toEqual(region);
    const batch = buildDataNodeFieldChoices({ nodeId: "query", nodes: [query], formSchemas: { customers: schema } });
    expect(batch[0].props).toEqual(region);
    expect(fieldTypeMatches(batch[0].fieldType, association, batch[0].props, region)).toBe(true);
  });
});
