"use client";

import { Button, Description, ListBox, Radio, RadioGroup, Select, Spinner } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { useEffect, useMemo, useState } from "react";
import { FormSelect } from "@/features/form-controls/components/FormSelect";
import { MemberMultiSelect } from "@/shared/ui/MemberMultiSelect";
import type { ApiFormSummary } from "@/features/automation-editor/api";
import { addMappingRow, createFieldMappingRow, removeMappingRow, syncRequiredRows, updateMappingRow } from "@/features/automation-editor/field-mapping";
import { fieldTypeMatches, normalizeInitiateApprovalConfig, workflowDraftFields } from "../../model/automation-editor-model";
import type { InitiateApprovalConfig, FormSchemaDescriptor, MemberOption, SourceFieldChoice } from "@/features/automation-editor/model/editor-types";
import { WorkflowConfigGroup } from "@/features/workflow/editor/WorkflowConfigGroup";
import { MappingRowsEditor } from "./AutomationFieldMappingEditor";

export function AutomationInitiateApprovalConfig({ appId, forms, config: rawConfig, schema, schemaStatus, onRetry, members, sourceFieldChoices, sourceNodeOptions, onChange }: {
  appId: string;
  forms: ApiFormSummary[];
  config: InitiateApprovalConfig;
  schema?: FormSchemaDescriptor;
  schemaStatus?: "loading" | "ready" | "error";
  onRetry: () => void;
  members: MemberOption[];
  sourceFieldChoices: SourceFieldChoice[];
  sourceNodeOptions: Array<{ id: string; label: string; description: string }>;
  onChange: (config: InitiateApprovalConfig) => void;
}) {
  const config = normalizeInitiateApprovalConfig(rawConfig);
  const fields = workflowDraftFields(schema);
  const rows = syncRequiredRows(config.rows ?? [], fields);
  const [isQuickMapOpen, setIsQuickMapOpen] = useState(false);
  const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<string | null>(null);
  const quickMapCandidates = useMemo(() => {
    if (!selectedSourceNodeId) return [];
    const prefix = `${selectedSourceNodeId}:`;
    return fields.flatMap((field) => {
      const source = sourceFieldChoices.find((choice) => choice.key.startsWith(prefix) && choice.label.endsWith(`.${field.label}`) && fieldTypeMatches(choice.fieldType, field.type, choice.props, field.props));
      return source ? [{ field, source }] : [];
    });
  }, [fields, selectedSourceNodeId, sourceFieldChoices]);
  useEffect(() => {
    if (rows.length === (config.rows ?? []).length) return;
    const timer = window.setTimeout(() => onChange({ ...config, rows }), 0);
    return () => window.clearTimeout(timer);
  }, [config, rows, onChange]);
  const memberFields = fields.filter((field) => field.type === "member");
  return <>
    <MappingRowsEditor title="流程表单与字段设置" rows={rows} targetFields={fields} sourceFieldChoices={sourceFieldChoices} leadingAction={<Button size="sm" variant="secondary" onPress={() => { setSelectedSourceNodeId(sourceNodeOptions[0]?.id ?? null); setIsQuickMapOpen(true); }} isDisabled={sourceNodeOptions.length === 0 || fields.length === 0}>快速映射</Button>} onAddMappingRow={() => { const field = fields.find((field) => !rows.some((row) => row.fieldId === field.id)); if (field) onChange({ ...config, rows: addMappingRow(rows, field.id) }); }} onRemoveMappingRow={(id) => { if (!fields.find((field) => field.id === rows.find((row) => row.id === id)?.fieldId)?.isRequired) onChange({ ...config, rows: removeMappingRow(rows, id) }); }} onRowChange={(id, key, value) => { if (key === "fieldId" && fields.find((field) => field.id === rows.find((row) => row.id === id)?.fieldId)?.isRequired) return; onChange({ ...config, rows: updateMappingRow(rows, id, key, value) }); }} >
    <FormSelect label="选择流程表单" appId={appId} forms={forms} formTypes={["workflow"]} requiredAction="create" allowCrossApp value={config.targetFormUuid ?? ""} onChange={() => { }} onFormSelect={(form) => onChange({ ...config, targetFormUuid: form.id, targetAppId: form.appId ?? appId, rows: [], initiatorFieldId: "" })} />
      {schemaStatus === "loading" ? <Spinner aria-label="加载流程表单字段" /> : null}
      {schemaStatus === "error" ? <><Description>流程表单字段加载失败</Description><Button onPress={onRetry}>重新加载</Button></> : null}
    </MappingRowsEditor>
    <Modal isOpen={isQuickMapOpen} onOpenChange={setIsQuickMapOpen}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="theme-menu-surface">
            <Modal.Header><Modal.Heading>快速映射</Modal.Heading><Modal.CloseTrigger aria-label="关闭快速映射" /></Modal.Header>
            <Modal.Body className="space-y-3">
              <Description>选择数据源节点，将自动添加名称和字段类型匹配的字段。</Description>
              <Select aria-label="数据源节点" placeholder="选择数据源节点" selectedKey={selectedSourceNodeId} onSelectionChange={(key) => setSelectedSourceNodeId(key ? String(key) : null)}>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{sourceNodeOptions.map((option) => <ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}（{option.description}）</ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
              {selectedSourceNodeId ? <Description>可映射 {quickMapCandidates.length} 个同名字段{quickMapCandidates.length === 0 ? "，没有可添加的匹配项" : ""}</Description> : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setIsQuickMapOpen(false)}>取消</Button>
              <Button isDisabled={!selectedSourceNodeId || quickMapCandidates.length === 0} onPress={() => {
                const mappedRows = [...rows];
                for (const { field, source } of quickMapCandidates) {
                  const existingIndex = mappedRows.findIndex((row) => row.fieldId === field.id);
                  const mappedValue = { valueType: "field" as const, sourceFieldKey: source.key, rawValue: "", formula: "" };
                  if (existingIndex >= 0) mappedRows[existingIndex] = { ...mappedRows[existingIndex], ...mappedValue };
                  else mappedRows.push({ ...createFieldMappingRow(field.id), ...mappedValue });
                }
                onChange({ ...config, rows: mappedRows });
                setIsQuickMapOpen(false);
              }}>添加映射</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
