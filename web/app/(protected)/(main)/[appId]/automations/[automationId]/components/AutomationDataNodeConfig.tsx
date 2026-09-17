"use client";

import { Input, ListBox, Select } from "@heroui/react";
import type { ApiFormSummary } from "@/features/automation-editor/api";
import {
  getSourceModeLabel,
  normalizeActionConfig,
  normalizeAddDataConfig,
  normalizeGetDataConfig,
  type ActionConfig,
  type AddDataConfig,
  type AddRecordMode,
  type AddTargetMode,
  type BranchRule,
  type DataSourceMode,
  type FieldMappingRow,
  type FormSchemaDescriptor,
  type SourceFieldChoice,
  type UpdateMode,
  type WorkflowNode,
} from "../automation-editor-model";
import { BranchRulesEditor } from "./AutomationConditionRuleEditor";
import { MappingRowsEditor } from "./AutomationFieldMappingEditor";
import {
  ExpressionEditor,
  FormSelect,
  PropertyField,
  PropertyPanelSection,
  TextAreaInput,
  UpdateTargetFormSelect,
} from "./AutomationNodeConfigPrimitives";

type NodeOption = { id: string; label: string; description: string };

export function DataNodeConfigFields({
  forms,
  getManySourceOptions,
  multipleSourceFieldChoices,
  node,
  onActionTargetFormChange,
  onAddDataConfigChange,
  onAddMappingRow,
  onAddUpdateRule,
  onBasicChange,
  onGetNodeFormChange,
  onGetNodeSourceModeChange,
  onGetNodeSourceNodeChange,
  onRemoveMappingRow,
  onRemoveUpdateRule,
  onRowChange,
  onUpdateConfigChange,
  onUpdateRuleChange,
  onUpdateSourceNodeChange,
  selectedSchema,
  sourceFieldChoices,
  updateSourceOptions,
  updateTargetFormOptions,
}: {
  forms: ApiFormSummary[];
  getManySourceOptions: NodeOption[];
  multipleSourceFieldChoices: SourceFieldChoice[];
  node: WorkflowNode;
  onActionTargetFormChange: (formUuid: string) => void;
  onAddDataConfigChange: <K extends keyof AddDataConfig>(key: K, value: AddDataConfig[K]) => void;
  onAddMappingRow: () => void;
  onAddUpdateRule: (parentId?: string, siblingOfId?: string) => void;
  onBasicChange: (key: string, value: string) => void;
  onGetNodeFormChange: (formUuid: string) => void;
  onGetNodeSourceModeChange: (value: DataSourceMode) => void;
  onGetNodeSourceNodeChange: (nodeId: string) => void;
  onRemoveMappingRow: (rowId: string) => void;
  onRemoveUpdateRule: (ruleId: string) => void;
  onRowChange: (rowId: string, key: keyof FieldMappingRow, value: string) => void;
  onUpdateConfigChange: <K extends keyof ActionConfig>(key: K, value: ActionConfig[K]) => void;
  onUpdateRuleChange: (ruleId: string, key: keyof BranchRule, value: string) => void;
  onUpdateSourceNodeChange: (nodeId: string) => void;
  selectedSchema?: FormSchemaDescriptor;
  sourceFieldChoices: SourceFieldChoice[];
  updateSourceOptions: NodeOption[];
  updateTargetFormOptions: Array<{ id: string; label: string }>;
}) {
if (node.data.kind === "get-one" || node.data.kind === "get-many") {
  const config = normalizeGetDataConfig(node.data.config);
  const sourceNodeOptions = sourceFieldChoices
    .filter((item) => item.key.includes(":"))
    .map((item) => item.key.split(":")[0])
    .filter((value, index, array) => array.indexOf(value) === index);
  return (
    <PropertyPanelSection title="数据来源配置">
      <Select
        aria-label="数据来源"
        selectedKey={config.sourceMode ?? "form"}
        onSelectionChange={(key) =>
          onGetNodeSourceModeChange(String(key ?? "form") as DataSourceMode)
        }
      >
        <Select.Trigger>
          <Select.Value>{getSourceModeLabel(config.sourceMode ?? "form")}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="form" textValue="从表单获取">
              从表单获取
            </ListBox.Item>
            <ListBox.Item id="data-node" textValue="从数据节点获取">
              从数据节点获取
            </ListBox.Item>
            <ListBox.Item id="related-form" textValue="从关联表单获取">
              从关联表单获取
            </ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      {config.sourceMode === "form" ? (
        <FormSelect
          forms={forms}
          value={config.formUuid ?? ""}
          placeholder="选择来源表单"
          onChange={onGetNodeFormChange}
        />
      ) : null}
      {config.sourceMode === "data-node" ? (
        <Select
          aria-label="数据节点"
          selectedKey={config.dataNodeId || "none"}
          onSelectionChange={(key) =>
            onGetNodeSourceNodeChange(String(key === "none" ? "" : key ?? ""))
          }
        >
          <Select.Trigger>
            <Select.Value>{config.dataNodeId || "选择数据节点"}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="none" textValue="未配置">
                未配置
              </ListBox.Item>
              {sourceNodeOptions.map((nodeId) => (
                <ListBox.Item key={nodeId} id={nodeId} textValue={nodeId}>
                  {nodeId}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : null}
      {config.sourceMode === "related-form" ? (
        <Input
          aria-label="关联表单占位"
          placeholder="关联表单组件暂未开发，先预留配置"
          value={config.relatedFormPlaceholder ?? ""}
          onChange={(event) =>
            onBasicChange("relatedFormPlaceholder", event.currentTarget.value)
          }
        />
      ) : null}
      <ExpressionEditor
        ariaLabel="筛选条件"
        helperText="筛选条件支持插入上游字段引用。"
        options={sourceFieldChoices}
        placeholder="筛选条件，例如 {{trigger:code}} == code"
        value={config.filterExpression ?? ""}
        onChange={(value) => onBasicChange("filterExpression", value)}
      />
      <Input
        aria-label="返回字段"
        placeholder="返回字段，例如 code,name,status"
        value={config.fieldSelection ?? ""}
        onChange={(event) => onBasicChange("fieldSelection", event.currentTarget.value)}
      />
    </PropertyPanelSection>
  );
}

if (node.data.kind === "add-data") {
  const config = normalizeAddDataConfig(node.data.config);
  const rows = config.rows ?? [];
  const targetFields = selectedSchema?.fields ?? [];
  const hasMultipleSourceNode = getManySourceOptions.some(
    (item) => item.id === config.multipleSourceNodeId,
  );
  const canConfigureFieldMappings =
    config.recordMode !== "multiple" || hasMultipleSourceNode;
  const activeSourceFields =
    config.recordMode === "multiple" ? multipleSourceFieldChoices : sourceFieldChoices;
  return (
    <div className="space-y-4">
      <PropertyPanelSection title="新增方式">
        <PropertyField label="新增位置">
          <Select
            aria-label="新增位置"
            selectedKey={config.targetMode ?? "form"}
            onSelectionChange={(key) =>
              onAddDataConfigChange(
                "targetMode",
                String(key ?? "form") as AddTargetMode,
              )
            }
          >
            <Select.Trigger>
              <Select.Value>
                {config.targetMode === "subtable" ? "在子表中新增" : "在表单中新增"}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="form" textValue="在表单中新增">
                  在表单中新增
                </ListBox.Item>
                <ListBox.Item id="subtable" textValue="在子表中新增">
                  在子表中新增
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </PropertyField>
        <PropertyField label="目标表单">
          <FormSelect
            forms={forms}
            value={config.targetFormUuid ?? ""}
            placeholder="选择目标表单"
            onChange={onActionTargetFormChange}
          />
        </PropertyField>
        <PropertyField label="新增数据">
          <Select
            aria-label="新增数据方式"
            selectedKey={config.recordMode ?? "single"}
            onSelectionChange={(key) =>
              onAddDataConfigChange("recordMode", String(key ?? "single") as AddRecordMode)
            }
          >
            <Select.Trigger>
              <Select.Value>
                {config.recordMode === "multiple" ? "新增多条数据" : "新增单条数据"}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="single" textValue="新增单条数据">
                  新增单条数据
                </ListBox.Item>
                <ListBox.Item id="multiple" textValue="新增多条数据">
                  新增多条数据
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </PropertyField>
        {config.recordMode === "multiple" ? (
          <PropertyField label="数据来源">
            <Select
              aria-label="多条数据来源"
              selectedKey={config.multipleSourceNodeId || "none"}
              onSelectionChange={(key) =>
                onAddDataConfigChange(
                  "multipleSourceNodeId",
                  String(key === "none" ? "" : key ?? ""),
                )
              }
            >
              <Select.Trigger>
                <Select.Value>
                  {getManySourceOptions.find((item) => item.id === config.multipleSourceNodeId)
                    ?.label ?? "选择获取多条数据节点"}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="none" textValue="未配置">
                    未配置
                  </ListBox.Item>
                  {getManySourceOptions.map((item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                      <div className="text-sm text-[var(--color-text-primary)]">{item.label}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">{item.description}</div>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {getManySourceOptions.length === 0 ? (
              <div className="mt-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-warning)]">
                请先在当前节点前添加“获取多条数据”节点，再作为多条新增的数据源。
              </div>
            ) : null}
          </PropertyField>
        ) : null}
      </PropertyPanelSection>

      {canConfigureFieldMappings ? (
        <MappingRowsEditor
          rows={rows}
          sourceFieldChoices={activeSourceFields}
          targetFields={targetFields}
          onAddMappingRow={onAddMappingRow}
          onRemoveMappingRow={onRemoveMappingRow}
          onRowChange={onRowChange}
        />
      ) : (
        <PropertyPanelSection title="字段设置">
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            请选择前置的“获取多条数据”节点后再配置字段设置。
          </div>
        </PropertyPanelSection>
      )}
    </div>
  );
}

if (
  node.data.kind === "update-data" ||
  node.data.kind === "delete-data"
) {
  const config = normalizeActionConfig(node.data.config);
  const targetFields = selectedSchema?.fields ?? [];
  const directUpdateRuleFieldChoices = targetFields.map((field) => ({
    key: field.id,
    label: field.label,
    fieldType: field.type,
    options: field.options,
  }));
  const hasUpdateSourceNode = updateSourceOptions.some(
    (item) => item.id === config.sourceNodeId,
  );
  const canConfigureUpdateFields =
    node.data.kind !== "update-data" ||
    (config.updateMode === "data-node"
      ? hasUpdateSourceNode && targetFields.length > 0
      : Boolean(config.targetFormUuid));
  return (
    <div className="space-y-4">
      <PropertyPanelSection title={node.data.kind === "update-data" ? "更新配置" : "删除配置"}>
        {node.data.kind === "update-data" ? (
          <>
            <PropertyField label="更新方式">
              <Select
                aria-label="更新方式"
                selectedKey={config.updateMode ?? "form"}
                onSelectionChange={(key) =>
                  onUpdateConfigChange(
                    "updateMode",
                    String(key ?? "form") as UpdateMode,
                  )
                }
              >
                <Select.Trigger>
                  <Select.Value>
                    {config.updateMode === "data-node"
                      ? "按节点更新表单数据"
                      : "直接更新表单数据"}
                  </Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="data-node" textValue="按节点更新表单数据">
                      按节点更新表单数据
                    </ListBox.Item>
                    <ListBox.Item id="form" textValue="直接更新表单数据">
                      直接更新表单数据
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </PropertyField>
            {config.updateMode === "data-node" ? (
              <PropertyField label="数据源">
                <Select
                  aria-label="更新数据源"
                  selectedKey={config.sourceNodeId || "none"}
                  onSelectionChange={(key) =>
                    onUpdateSourceNodeChange(String(key === "none" ? "" : key ?? ""))
                  }
                >
                  <Select.Trigger>
                    <Select.Value>
                      {updateSourceOptions.find((item) => item.id === config.sourceNodeId)
                        ?.label ?? "选择查询节点"}
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="none" textValue="未配置">
                        未配置
                      </ListBox.Item>
                      {updateSourceOptions.map((item) => (
                        <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                          <div className="text-sm text-[var(--color-text-primary)]">{item.label}</div>
                          <div className="text-xs text-[var(--color-text-secondary)]">{item.description}</div>
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                {updateSourceOptions.length === 0 ? (
                  <div className="mt-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-warning)]">
                    请先添加“获取单条数据”或“获取多条数据”节点。
                  </div>
                ) : null}
              </PropertyField>
            ) : (
              <>
                <PropertyField label="目标表单">
                  <UpdateTargetFormSelect
                    options={updateTargetFormOptions}
                    value={config.targetFormUuid ?? ""}
                    onChange={onActionTargetFormChange}
                  />
                </PropertyField>
                {config.targetFormUuid ? (
                  <BranchRulesEditor
                    rules={config.rules ?? []}
                    sourceFieldChoices={directUpdateRuleFieldChoices}
                    onAddConditionRule={onAddUpdateRule}
                    onConditionRuleChange={onUpdateRuleChange}
                    onRemoveConditionRule={onRemoveUpdateRule}
                  />
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <FormSelect
              forms={forms}
              value={config.targetFormUuid ?? ""}
              placeholder="选择目标表单"
              onChange={onActionTargetFormChange}
            />
            <ExpressionEditor
              ariaLabel="匹配条件"
              helperText="匹配条件支持引用触发记录和查询节点字段。"
              options={sourceFieldChoices}
              placeholder="匹配条件，例如 {{get-one-1:id}} == id"
              value={config.matchRule ?? ""}
              onChange={(value) => onBasicChange("matchRule", value)}
            />
          </>
        )}
      </PropertyPanelSection>
      {node.data.kind === "update-data" ? (
        canConfigureUpdateFields ? (
          <MappingRowsEditor
            lockRequiredRows={false}
            rows={config.rows ?? []}
            sourceFieldChoices={sourceFieldChoices}
            targetFields={targetFields}
            onAddMappingRow={onAddMappingRow}
            onRemoveMappingRow={onRemoveMappingRow}
            onRowChange={onRowChange}
          />
        ) : (
          <PropertyPanelSection title="字段设置">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
              {config.updateMode === "data-node"
                ? "请选择可用的查询节点后再配置字段设置。"
                : "请选择目标表单后再配置字段设置。"}
            </div>
          </PropertyPanelSection>
        )
      ) : null}
    </div>
  );
}

if (node.data.kind === "http-request") {
  const config = normalizeActionConfig(node.data.config);
  return (
    <PropertyPanelSection title="连接器配置">
      <Input
        aria-label="请求方法"
        placeholder="POST / GET / PUT"
        value={config.method ?? ""}
        onChange={(event) => onBasicChange("method", event.currentTarget.value)}
      />
      <Input
        aria-label="请求地址"
        placeholder="https://example.com/webhook"
        value={config.url ?? ""}
        onChange={(event) => onBasicChange("url", event.currentTarget.value)}
      />
      <TextAreaInput
        ariaLabel="请求头"
        placeholder="请求头 JSON"
        value={config.headersText ?? ""}
        onChange={(value) => onBasicChange("headersText", value)}
      />
      <TextAreaInput
        ariaLabel="请求体"
        placeholder="请求体模板"
        value={config.bodyTemplate ?? ""}
        onChange={(value) => onBasicChange("bodyTemplate", value)}
      />
    </PropertyPanelSection>
  );
}


  return null;
}
