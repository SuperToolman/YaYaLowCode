"use client";

import { Button, Description, ListBox, Radio, RadioGroup, Select, Spinner } from "@heroui/react";
import { useEffect } from "react";
import { FormSelect } from "@/components/FormSelect";
import { MemberMultiSelect } from "@/components/MemberMultiSelect";
import type { ApiFormSummary } from "@/features/automation-editor/api";
import { addMappingRow, removeMappingRow, syncRequiredRows, updateMappingRow } from "@/features/automation-editor/field-mapping";
import { normalizeInitiateApprovalConfig, workflowDraftFields, type InitiateApprovalConfig, type FormSchemaDescriptor, type MemberOption, type SourceFieldChoice } from "../automation-editor-model";
import { WorkflowConfigGroup } from "@/app/components/workflow-editor/WorkflowConfigGroup";
import { MappingRowsEditor } from "./AutomationFieldMappingEditor";

export function AutomationInitiateApprovalConfig({ appId, forms, config: rawConfig, schema, schemaStatus, onRetry, members, sourceFieldChoices, onChange }: {
  appId: string;
  forms: ApiFormSummary[];
  config: InitiateApprovalConfig;
  schema?: FormSchemaDescriptor;
  schemaStatus?: "loading" | "ready" | "error";
  onRetry: () => void;
  members: MemberOption[];
  sourceFieldChoices: SourceFieldChoice[];
  onChange: (config: InitiateApprovalConfig) => void;
}) {
  const config = normalizeInitiateApprovalConfig(rawConfig);
  const fields = workflowDraftFields(schema);
  const rows = syncRequiredRows(config.rows ?? [], fields);
  useEffect(() => {
    if (rows.length === (config.rows ?? []).length) return;
    const timer = window.setTimeout(() => onChange({ ...config, rows }), 0);
    return () => window.clearTimeout(timer);
  }, [config, rows, onChange]);
  const memberFields = fields.filter((field) => field.type === "member");
  return <>
    <MappingRowsEditor title="流程表单与字段设置" rows={rows} targetFields={fields} sourceFieldChoices={sourceFieldChoices} onAddMappingRow={() => { const field = fields.find((field) => !rows.some((row) => row.fieldId === field.id)); if (field) onChange({ ...config, rows: addMappingRow(rows, field.id) }); }} onRemoveMappingRow={(id) => { if (!fields.find((field) => field.id === rows.find((row) => row.id === id)?.fieldId)?.isRequired) onChange({ ...config, rows: removeMappingRow(rows, id) }); }} onRowChange={(id, key, value) => { if (key === "fieldId" && fields.find((field) => field.id === rows.find((row) => row.id === id)?.fieldId)?.isRequired) return; onChange({ ...config, rows: updateMappingRow(rows, id, key, value) }); }} >
    <FormSelect label="选择流程表单" appId={appId} forms={forms} formTypes={["workflow"]} requiredAction="create" allowCrossApp value={config.targetFormUuid ?? ""} onChange={() => { }} onFormSelect={(form) => onChange({ ...config, targetFormUuid: form.id, targetAppId: form.appId ?? appId, rows: [], initiatorFieldId: "" })} />
      {schemaStatus === "loading" ? <Spinner aria-label="加载流程表单字段" /> : null}
      {schemaStatus === "error" ? <><Description>流程表单字段加载失败</Description><Button onPress={onRetry}>重新加载</Button></> : null}
    </MappingRowsEditor>
    <WorkflowConfigGroup title="选择发起人">
    <RadioGroup aria-label="发起人来源" orientation="horizontal" value={config.initiatorMode ?? "member"} onChange={(value) => onChange({ ...config, initiatorMode: value === "field" ? "field" : "member", initiatorId: "", initiatorFieldId: "" })}>
      <Radio value="member"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>指定人员</Radio.Content></Radio>
      <Radio value="field"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>表单成员字段</Radio.Content></Radio>
    </RadioGroup>
    {config.initiatorMode === "field" ? <Select aria-label="发起人成员字段" placeholder="选择成员字段" selectedKey={config.initiatorFieldId || null} onSelectionChange={(key) => onChange({ ...config, initiatorFieldId: String(key ?? "") })}>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>{memberFields.map((field) => <ListBox.Item key={field.id} id={field.id} textValue={field.label}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover>
    </Select> : <MemberMultiSelect selectionMode="single" options={members.map((member) => ({ id: member.id, label: member.displayName, avatarUrl: member.avatarUrl, sourceType: member.sourceType, disabled: member.status !== "active" }))} value={config.initiatorId ? [config.initiatorId] : []} onChange={(ids) => onChange({ ...config, initiatorId: ids[0] ?? "" })} placeholder="选择发起人" />}
    </WorkflowConfigGroup>
  </>;
}
