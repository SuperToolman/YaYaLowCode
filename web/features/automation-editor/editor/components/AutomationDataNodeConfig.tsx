"use client";

import { Button, Input, ListBox, Select, Radio, RadioGroup } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { useState } from "react";
import { FormSelect as GlobalFormSelect } from "@/features/form-controls/components/FormSelect";
import { SubformSelect } from "@/features/form-controls/components/SubformSelect";
import { AutomationNodeSelect } from "@/features/automation-editor/node-select/AutomationNodeSelect";
import type { ApiFormSummary } from "@/features/automation-editor/api";
import { buildRecordFieldChoices, buildSubformParentOptions, SUBFORM_PARENT_NODE_KINDS, isSubformParentNode, addDataTargetFields, fieldTypeMatches, getSourceModeLabel, normalizeActionConfig, normalizeAddDataConfig, normalizeGetDataConfig } from "../../model/automation-editor-model";
import type { WorkflowEdge, ActionConfig, AddDataConfig, AddRecordMode, AddTargetMode, DataSourceMode, FormSchemaDescriptor, SourceFieldChoice, UpdateMode, WorkflowNode } from "@/features/automation-editor/model/editor-types";
import type { BranchRule } from "@/features/conditions";
import { createFieldMappingRow, type FieldMappingRow } from "@/features/automation-editor/field-mapping";
import { BranchRulesEditor } from "./AutomationConditionRuleEditor";
import { MappingRowsEditor } from "./AutomationFieldMappingEditor";
import { PropertyField, PropertyPanelSection, TextAreaInput } from "./AutomationNodeConfigPrimitives";
import { MyShip } from "@/shared/ui/MyShip";

type NodeOption = { id: string; label: string; description: string };

export function DataNodeConfigFields({
  nodes,
  edges,
  appId,
  forms,
  flowState,
  getManySourceOptions,
  getSourceOptions,
  getSchemaStatus,
  onRetryGetSchema,
  onGetFilterModeChange,
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
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  appId: string;
  forms: ApiFormSummary[];
  flowState?: import("../../model/automation-editor-model").FlowState;
  getManySourceOptions: NodeOption[];
  getSchemaStatus?: "loading" | "ready" | "error";
  onRetryGetSchema?: () => void;
  getSourceOptions?: NodeOption[];
  onGetFilterModeChange?: (mode: "all" | "rules") => void;
  multipleSourceFieldChoices: SourceFieldChoice[];
  node: WorkflowNode;
  onActionTargetFormChange: (formUuid: string) => void;
  onAddDataConfigChange: <K extends keyof AddDataConfig>(
    key: K,
    value: AddDataConfig[K],
  ) => void;
  onAddMappingRow: () => void;
  onAddUpdateRule: (parentId?: string, siblingOfId?: string) => void;
  onBasicChange: (key: string, value: string) => void;
  onGetNodeFormChange: (formUuid: string) => void;
  onGetNodeSourceModeChange: (value: DataSourceMode) => void;
  onGetNodeSourceNodeChange: (nodeId: string) => void;
  onRemoveMappingRow: (rowId: string) => void;
  onRemoveUpdateRule: (ruleId: string) => void;
  onRowChange: (
    rowId: string,
    key: keyof FieldMappingRow,
    value: string,
  ) => void;
  onUpdateConfigChange: <K extends keyof ActionConfig>(
    key: K,
    value: ActionConfig[K],
  ) => void;
  onUpdateRuleChange: (
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) => void;
  onUpdateSourceNodeChange: (nodeId: string) => void;
  selectedSchema?: FormSchemaDescriptor;
  sourceFieldChoices: SourceFieldChoice[];
  updateSourceOptions: NodeOption[];
  updateTargetFormOptions: Array<{ id: string; label: string }>;
}) {
  const [isQuickMapOpen, setIsQuickMapOpen] = useState(false);
  const [selectedQuickMapNodeId, setSelectedQuickMapNodeId] = useState<string | null>(null);
  if (node.data.kind === "get-one" || node.data.kind === "get-many") {
    const config = normalizeGetDataConfig(node.data.config);
    const options = getSourceOptions ?? [];
    const sourceFields = buildRecordFieldChoices(selectedSchema?.fields ?? [], forms.some((form) => form.id === selectedSchema?.formUuid && form.formType === "workflow"));
    const sourceSelected = config.sourceMode === "trigger" ? true : config.sourceMode === "form" ? Boolean(config.formUuid) : Boolean(config.dataNodeId);
    const selectedOption = options.find((item) => item.id === config.dataNodeId);
    const invalidSourceNode = config.sourceMode === "data-node" && Boolean(config.dataNodeId) && !selectedOption;
    const sourceNotice = invalidSourceNode
      ? "已选数据节点已失效，请重新选择。"
      : config.sourceMode === "data-node" && options.length === 0
        ? "没有可用的上游数据节点，请先连接有记录输出的触发或获取节点。"
        : !sourceSelected
          ? "请先选择数据来源。"
          : !selectedSchema
            ? getSchemaStatus === "loading" ? "正在加载来源表单结构…" : "来源表单结构加载失败，请重试。"
            : undefined;
    return (
      <div className="space-y-4">
      <PropertyPanelSection title="数据来源配置">
        <PropertyField label="数据来源">
          <Select aria-label="数据来源" selectedKey={config.sourceMode ?? "form"} onSelectionChange={(key) => onGetNodeSourceModeChange(String(key ?? "form") as DataSourceMode)}>
            <Select.Trigger><Select.Value>{getSourceModeLabel(config.sourceMode ?? "form")}</Select.Value><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox>
              <ListBox.Item id="form" textValue="从表单获取">从表单获取</ListBox.Item>
              <ListBox.Item id="data-node" textValue="从数据节点获取">从数据节点获取</ListBox.Item>
              {flowState?.triggerEvents.includes("button_click") ? <ListBox.Item id="trigger" textValue="使用触发记录">使用触发记录</ListBox.Item> : null}
            </ListBox></Select.Popover>
          </Select>
        </PropertyField>
        <PropertyField label={config.sourceMode === "form" ? "来源表单" : config.sourceMode === "trigger" ? "触发记录" : "数据节点"}>
          {config.sourceMode === "trigger" ? <p className="text-sm text-muted">使用点击按钮的表单和当前记录。</p> : config.sourceMode === "form" ? <GlobalFormSelect appId={appId} forms={forms} formTypes={["normal", "workflow"]} value={config.formUuid ?? ""} placeholder="选择来源表单" onChange={onGetNodeFormChange} /> :
            <div className="space-y-2">
              <AutomationNodeSelect nodes={nodes} edges={edges} currentNodeId={node.id}
                allowedKinds={["trigger", "get-one", "get-many"]} value={config.dataNodeId ?? ""}
                onChange={onGetNodeSourceNodeChange} />
            </div>}
        </PropertyField>
        {sourceNotice ? <div className="space-y-2">
          <MyShip color="warning" content={sourceNotice} />
          {sourceSelected && !invalidSourceNode && !selectedSchema ? <Button size="sm" isDisabled={getSchemaStatus === "loading"} onPress={onRetryGetSchema}>重新加载</Button> : null}
        </div> : null}
      </PropertyPanelSection>
      {sourceSelected && !invalidSourceNode && selectedSchema ? <PropertyPanelSection title="条件规则">
        <PropertyField label="筛选方式">
          <RadioGroup aria-label="筛选方式" orientation="horizontal" value={config.filterMode ?? "all"} onChange={(value) => onGetFilterModeChange?.(value as "all" | "rules")}>
            {[["all", "全部数据"], ["rules", "按条件过滤"]].map(([value, label]) => <Radio key={value} value={value}><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>{label}</Radio.Content></Radio>)}
          </RadioGroup>
        </PropertyField>
        {config.filterMode === "rules" && selectedSchema ? <BranchRulesEditor rules={config.rules ?? []} sourceFieldChoices={sourceFields} onAddConditionRule={onAddUpdateRule} onConditionRuleChange={onUpdateRuleChange} onRemoveConditionRule={onRemoveUpdateRule} /> : null}
      </PropertyPanelSection> : null}
      </div>
    );
  }

  if (node.data.kind === "add-data") {
    const config = normalizeAddDataConfig(node.data.config);
    const rows = config.rows ?? [];
    const targetFields = addDataTargetFields(selectedSchema);
    const parentOptions = buildSubformParentOptions(nodes, edges, node.id);
    const canConfigureRecords =
      Boolean(config.targetFormUuid?.trim()) && (config.targetMode !== "subtable" || Boolean(config.subformFieldId && selectedSchema && parentOptions.some((source) => source.id === config.parentDataNodeId)));
    const hasMultipleSourceNode = getManySourceOptions.some(
      (item) => item.id === config.multipleSourceNodeId,
    );
    const canConfigureFieldMappings =
      canConfigureRecords &&
      (config.recordMode === "single" ||
        (config.recordMode === "multiple" && hasMultipleSourceNode));
    const activeSourceFields =
      config.recordMode === "multiple"
        ? multipleSourceFieldChoices
        : sourceFieldChoices;
    const quickMapSourceOptions = config.recordMode === "multiple"
      ? getManySourceOptions.filter((option) => option.id === config.multipleSourceNodeId)
      : getSourceOptions ?? [];
    const quickMapCandidates = !selectedQuickMapNodeId ? [] : (() => {
      const prefix = `${selectedQuickMapNodeId}:`;
      return targetFields.flatMap((field) => {
        const source = activeSourceFields.find((choice) => choice.key.startsWith(prefix) && choice.label.endsWith(`.${field.label}`) && fieldTypeMatches(choice.fieldType, field.type, choice.props, field.props));
        return source ? [{ field, source }] : [];
      });
    })();
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
                  {config.targetMode === "subtable"
                    ? "在子表中新增"
                    : "在表单中新增"}
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
          {config.targetMode !== "subtable" ? <PropertyField label="目标表单">
            <GlobalFormSelect
              appId={appId}
              formTypes={["normal", "workflow"]}
              requiredAction="create"
              forms={forms}
              value={config.targetFormUuid ?? ""}
              placeholder="选择目标表单"
              onChange={onActionTargetFormChange}
            />
          </PropertyField> : <>
            <PropertyField label="数据节点">
              <AutomationNodeSelect nodes={nodes} edges={edges} currentNodeId={node.id}
                allowedKinds={SUBFORM_PARENT_NODE_KINDS} isSelectable={isSubformParentNode}
                ariaLabel="子表所属数据节点" value={config.parentDataNodeId ?? ""}
                onChange={(id) => onAddDataConfigChange("parentDataNodeId", id)} />
            </PropertyField>
            {config.parentDataNodeId ? <PropertyField label="目标子表"><SubformSelect parentFormId={config.targetFormUuid ?? ""} value={config.subformFieldId ?? ""} onChange={(id) => onAddDataConfigChange("subformFieldId", id)} /></PropertyField> : null}
          </>}
          {canConfigureRecords ? (
            <PropertyField label="新增数据">
              <Select
                aria-label="新增数据方式"
                selectedKey={config.recordMode ?? "single"}
                onSelectionChange={(key) =>
                  onAddDataConfigChange(
                    "recordMode",
                    String(key ?? "single") as AddRecordMode,
                  )
                }
              >
                <Select.Trigger>
                  <Select.Value>
                    {config.recordMode === "multiple"
                      ? "新增多条数据"
                      : "新增单条数据"}
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
          ) : null}
          {canConfigureRecords && config.recordMode === "multiple" ? (
            <PropertyField label="数据来源">
              <div className="flex gap-2">
                <AutomationNodeSelect nodes={nodes} edges={edges} currentNodeId={node.id}
                  allowedKinds={["get-many"]} ariaLabel="多条数据来源"
                  placeholder="选择获取多条数据节点" value={config.multipleSourceNodeId ?? ""}
                  onChange={(id) => onAddDataConfigChange("multipleSourceNodeId", id)} />
                {getManySourceOptions.length === 0 ? (
                  <MyShip color="warning" content="请先在当前节点前添加“获取多条数据”节点，再作为多条新增的数据源。" />
                ) : null}
              </div>
            </PropertyField>
          ) : null}
        </PropertyPanelSection>

        {canConfigureFieldMappings ? (
            <MappingRowsEditor
              rows={rows}
              sourceFieldChoices={activeSourceFields}
              targetFields={targetFields}
              leadingAction={<Button size="sm" variant="secondary" onPress={() => { setSelectedQuickMapNodeId(quickMapSourceOptions[0]?.id ?? null); setIsQuickMapOpen(true); }} isDisabled={quickMapSourceOptions.length === 0 || targetFields.length === 0}>快速映射</Button>}
              onAddMappingRow={onAddMappingRow}
              onRemoveMappingRow={onRemoveMappingRow}
              onRowChange={onRowChange}
            />
        ) : null}
        <Modal isOpen={isQuickMapOpen} onOpenChange={setIsQuickMapOpen}>
          <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
            <Modal.Container placement="center" size="sm">
              <Modal.Dialog className="theme-menu-surface">
                <Modal.Header><Modal.Heading>快速映射</Modal.Heading><Modal.CloseTrigger aria-label="关闭快速映射" /></Modal.Header>
                <Modal.Body className="space-y-3">
                  <div className="text-sm text-[var(--color-text-secondary)]">选择数据源节点，将自动添加名称和字段类型匹配的字段。</div>
                  <Select aria-label="数据源节点" placeholder="选择数据源节点" selectedKey={selectedQuickMapNodeId} onSelectionChange={(key) => setSelectedQuickMapNodeId(key ? String(key) : null)}>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox>{quickMapSourceOptions.map((option) => <ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}（{option.description}）</ListBox.Item>)}</ListBox></Select.Popover>
                  </Select>
                  {selectedQuickMapNodeId ? <div className="text-sm text-[var(--color-text-secondary)]">可映射 {quickMapCandidates.length} 个同名字段{quickMapCandidates.length === 0 ? "，没有可添加的匹配项" : ""}</div> : null}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onPress={() => setIsQuickMapOpen(false)}>取消</Button>
                  <Button isDisabled={!selectedQuickMapNodeId || quickMapCandidates.length === 0} onPress={() => {
                    const mappedRows = [...rows];
                    for (const { field, source } of quickMapCandidates) {
                      const existingIndex = mappedRows.findIndex((row) => row.fieldId === field.id);
                      const mappedValue = { valueType: "field" as const, sourceFieldKey: source.key, rawValue: "", formula: "" };
                      if (existingIndex >= 0) mappedRows[existingIndex] = { ...mappedRows[existingIndex], ...mappedValue };
                      else mappedRows.push({ ...createFieldMappingRow(field.id), ...mappedValue });
                    }
                    onAddDataConfigChange("rows", mappedRows);
                    setIsQuickMapOpen(false);
                  }}>添加映射</Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </div>
    );
  }

  if (node.data.kind === "delete-data") {
    const config = normalizeActionConfig(node.data.config);
    const nodeMode = config.deleteMode === "data-node";
    const choices = buildRecordFieldChoices(selectedSchema?.fields ?? [], forms.some((form) => form.id === config.targetFormUuid && form.formType === "workflow"));
    return <div className="space-y-4">
      <PropertyPanelSection title="删除配置">
        <PropertyField label="删除方式">
          <Select aria-label="删除方式" selectedKey={config.deleteMode ?? "form"}
            onSelectionChange={(key) => onUpdateConfigChange("deleteMode", key === "data-node" ? "data-node" : "form")}>
            <Select.Trigger><Select.Value>{nodeMode ? "按节点删除数据" : "按表单条件删除"}</Select.Value><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox>
              <ListBox.Item id="form" textValue="按表单条件删除">按表单条件删除</ListBox.Item>
              <ListBox.Item id="data-node" textValue="按节点删除数据">按节点删除数据</ListBox.Item>
            </ListBox></Select.Popover>
          </Select>
        </PropertyField>
        {nodeMode ? <PropertyField label="数据节点">
          <AutomationNodeSelect nodes={nodes} edges={edges} currentNodeId={node.id}
            allowedKinds={SUBFORM_PARENT_NODE_KINDS} isSelectable={isSubformParentNode}
            ariaLabel="删除数据源" value={config.sourceNodeId ?? ""} onChange={onUpdateSourceNodeChange} />
          <p className="text-xs text-[var(--color-text-secondary)]">仅删除所选上游节点输出的记录。</p>
        </PropertyField> : <PropertyField label="目标表单">
          <GlobalFormSelect appId={appId} forms={forms} formTypes={["normal", "workflow"]}
            requiredAction="delete" value={config.targetFormUuid ?? ""} placeholder="选择目标表单" onChange={onActionTargetFormChange} />
        </PropertyField>}
        {config.matchRule?.trim() ? <MyShip color="warning" content="此节点含旧删除表达式，请重新配置条件规则或选择数据节点。" /> : null}
      </PropertyPanelSection>
      {!nodeMode && config.targetFormUuid ? <PropertyPanelSection title="条件规则">
        <RadioGroup aria-label="删除范围" orientation="horizontal" value={config.filterMode ?? "rules"}
          onChange={(value) => onUpdateConfigChange("filterMode", value === "all" ? "all" : "rules")}>
          {[["rules", "按条件删除"], ["all", "全部记录"]].map(([value, label]) => <Radio key={value} value={value}><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control>{label}</Radio.Content></Radio>)}
        </RadioGroup>
        {config.filterMode !== "all" ? (selectedSchema ? <BranchRulesEditor rules={config.rules ?? []}
          sourceFieldChoices={choices} onAddConditionRule={onAddUpdateRule}
          onConditionRuleChange={onUpdateRuleChange} onRemoveConditionRule={onRemoveUpdateRule} />
          : <MyShip color="warning" content="正在加载目标表单结构，请稍后重试。" />) : null}
      </PropertyPanelSection> : null}
    </div>;
  }

  if (node.data.kind === "update-data") {
    const config = normalizeActionConfig(node.data.config);
    const targetFields = selectedSchema?.fields ?? [];
    const directUpdateRuleFieldChoices = buildRecordFieldChoices(targetFields, forms.some((form) => form.id === config.targetFormUuid && form.formType === "workflow"));
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
        <PropertyPanelSection
          title={node.data.kind === "update-data" ? "更新配置" : "删除配置"}
        >
          {(
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
                      <ListBox.Item
                        id="data-node"
                        textValue="按节点更新表单数据"
                      >
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
                  <div className="flex gap-2">
                    <Select
                      className="flex-1"
                      aria-label="更新数据源"
                      placeholder="选择查询节点"
                      selectedKey={updateSourceOptions.some((item) => item.id === config.sourceNodeId) ? config.sourceNodeId : null}
                      onSelectionChange={(key) =>
                        onUpdateSourceNodeChange(
                          String(key ?? ""),
                        )
                      }
                    >
                      <Select.Trigger>
                        <Select.Value>
                          {updateSourceOptions.find(
                            (item) => item.id === config.sourceNodeId,
                          )?.label}
                        </Select.Value>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {updateSourceOptions.map((item) => (
                            <ListBox.Item
                              key={item.id}
                              id={item.id}
                              textValue={item.label}
                            >
                              <div className="text-sm text-[var(--color-text-primary)]">
                                {item.label}
                              </div>
                              <div className="text-xs text-[var(--color-text-secondary)]">
                                {item.description}
                              </div>
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {updateSourceOptions.length === 0 ? (
                      <MyShip color="warning" content="请先添加“获取单条数据”或“获取多条数据”节点。" />
                    ) : null}
                  </div>
                </PropertyField>
              ) : (
                <>
                  <PropertyField label="目标表单">
                    <GlobalFormSelect
                      appId={appId}
                      forms={forms}
                      formTypes={["normal", "workflow"]}
                      requiredAction="edit"
                      placeholder="选择目标表单"
                      value={config.targetFormUuid ?? ""}
                      onChange={onActionTargetFormChange}
                    />
                  </PropertyField>
                </>
              )}
            </>
          )}
        </PropertyPanelSection>
        {node.data.kind === "update-data" && config.updateMode !== "data-node" ? (
          <PropertyPanelSection title="条件规则">
            {config.targetFormUuid ? (
              <BranchRulesEditor
                rules={config.rules ?? []}
                sourceFieldChoices={directUpdateRuleFieldChoices}
                onAddConditionRule={onAddUpdateRule}
                onConditionRuleChange={onUpdateRuleChange}
                onRemoveConditionRule={onRemoveUpdateRule}
              />
            ) : (
              <MyShip color="warning" content="请先选择目标表单，再配置条件规则。" />
            )}
          </PropertyPanelSection>
        ) : null}
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
    const compensation = config.compensationRequest ?? {};
    const updateCompensation = (
      key: keyof NonNullable<typeof config.compensationRequest>,
      value: string,
    ) => onUpdateConfigChange("compensationRequest", { ...compensation, [key]: value });
    return (
      <>
      <PropertyPanelSection title="连接器配置">
        <Input
          aria-label="请求方法"
          placeholder="POST / GET / PUT"
          value={config.method ?? ""}
          onChange={(event) =>
            onBasicChange("method", event.currentTarget.value)
          }
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
      <PropertyPanelSection title="撤销请求（可选）">
        <Input
          aria-label="撤销请求方法"
          placeholder="POST / DELETE"
          value={compensation.method ?? ""}
          onChange={(event) => updateCompensation("method", event.currentTarget.value)}
        />
        <Input
          aria-label="撤销请求地址"
          placeholder="https://example.com/webhook/cancel"
          value={compensation.url ?? ""}
          onChange={(event) => updateCompensation("url", event.currentTarget.value)}
        />
        <TextAreaInput
          ariaLabel="撤销请求头"
          placeholder="撤销请求头 JSON"
          value={compensation.headersText ?? ""}
          onChange={(value) => updateCompensation("headersText", value)}
        />
        <TextAreaInput
          ariaLabel="撤销请求体"
          placeholder="撤销请求体模板"
          value={compensation.bodyTemplate ?? ""}
          onChange={(value) => updateCompensation("bodyTemplate", value)}
        />
      </PropertyPanelSection>
      </>
    );
  }

  return null;
}
