import { describe, expect, it } from "vitest";
import { addDataTargetFields, buildRecordFieldChoices, normalizeFormSchema, workflowDraftFields } from "./automation-editor-model";
import { mappingTargetFields } from "@/features/automation-editor/field-mapping";
import { BUILTIN_RECORD_FIELDS, WORKFLOW_BUILTIN_RECORD_FIELDS } from "@/features/form-model/field-metadata";

describe("字段映射目标", () => {
  const schema = normalizeFormSchema({ formUuid: "form", fields: [
    { id: "name", label: "创建人", type: "singleLineText" },
    ...[...BUILTIN_RECORD_FIELDS, ...WORKFLOW_BUILTIN_RECORD_FIELDS].map((field) => ({
      ...field, type: "singleLineText",
    })),
  ] });

  it("所有系统字段都不能写入，但同名业务字段仍可作为目标", () => {
    expect(mappingTargetFields(schema.fields).map((field) => field.id)).toEqual(["name"]);
    expect(workflowDraftFields(schema).map((field) => field.id)).toEqual(["name"]);
    expect(addDataTargetFields(schema).map((field) => field.id)).toEqual(["name"]);
  });

  it("空表单不会追加系统目标字段，来源仍可读取系统字段", () => {
    expect(addDataTargetFields()).toEqual([]);
    const sources = buildRecordFieldChoices(schema.fields, true);
    for (const field of [...BUILTIN_RECORD_FIELDS, ...WORKFLOW_BUILTIN_RECORD_FIELDS]) {
      expect(sources.find((source) => source.key === field.id)?.isSystem).toBe(true);
    }
  });
});
