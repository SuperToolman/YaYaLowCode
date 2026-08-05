import { MarkerType } from "@xyflow/react";
import type { ApiDetailForm, ApiFormSummary } from "@/features/automation-editor/api";
import { automationWorkflowPaletteGroups, processWorkflowPaletteGroups } from "../automation-workflow-node-registry";
import { triggerEvents, type AutomationStatus, type TriggerEvent } from "../automation-shared";
import {
  serializeWorkflowGraph,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowNodeData as WorkflowNodeDataBase,
} from "../../../../../components/workflow-editor/workflow-core";

export type WorkflowNodeKind =
  | "trigger"
  | "condition"
  | "add-data"
  | "update-data"
  | "get-one"
  | "get-many"
  | "delete-data"
  | "http-request"
  | "approval"
  | "copy"
  | "executor"
  | "end";

export type FieldValueType = "value" | "field" | "formula";
export type DataSourceMode = "form" | "data-node" | "related-form";
export type AddTargetMode = "form" | "subtable";
export type AddRecordMode = "single" | "multiple";
export type UpdateMode = "data-node" | "form";

export type FieldOption = {
  label: string;
  value: string;
};

export type SourceFieldChoice = {
  key: string;
  label: string;
  fieldType: string;
  options: FieldOption[];
};

export type FormFieldDescriptor = {
  id: string;
  label: string;
  type: string;
  isRequired: boolean;
  options: FieldOption[];
};

export type FormSchemaDescriptor = {
  formUuid: string;
  formName: string;
  fields: FormFieldDescriptor[];
};

export type TriggerConfig = {
  changedFieldMode?: "any" | "specific";
  changedFieldId?: string;
  // Used only to migrate existing saved configurations.
  changedFieldsText?: string;
};

export type ConditionBranch = {
  id: string;
  name: string;
  mode: "all" | "rules" | "expression";
  priority: number;
  rules: BranchRule[];
  expression: string;
  hitLabel: string;
};

export type ConditionConfig = {
  branches?: ConditionBranch[];
};

export type BranchRule = {
  id: string;
  parentId?: string;
  isGroup?: boolean;
  logicalOperator?: "and" | "or";
  fieldKey?: string;
  operator?: BranchRuleOperator;
  rawValue?: string;
  valueType?: "value" | "field";
  sourceFieldKey?: string;
};

export type BranchRuleOperator =
  | "eq"
  | "neq"
  | "inAny"
  | "notInAny"
  | "hasValue"
  | "noValue";

export type GetDataConfig = {
  sourceMode?: DataSourceMode;
  formUuid?: string;
  dataNodeId?: string;
  relatedFormPlaceholder?: string;
  filterExpression?: string;
  fieldSelection?: string;
};

export type FieldMappingRow = {
  id: string;
  fieldId: string;
  valueType: FieldValueType;
  rawValue?: string;
  sourceFieldKey?: string;
  formula?: string;
};

export type AddDataConfig = {
  targetMode?: AddTargetMode;
  targetFormUuid?: string;
  recordMode?: AddRecordMode;
  rows?: FieldMappingRow[];
  multipleSourceMode?: "form" | "data-node";
  multipleSourceNodeId?: string;
  multipleFormula?: string;
};

export type ActionConfig = {
  updateMode?: UpdateMode;
  sourceNodeId?: string;
  targetFormUuid?: string;
  rules?: BranchRule[];
  matchRule?: string;
  rows?: FieldMappingRow[];
  bodyTemplate?: string;
  method?: string;
  url?: string;
  headersText?: string;
};

export type AssigneeConfig = { assigneeIds?: string[]; assignees?: string[]; approvalMode?: "all" | "any" };
export type CopyConfig = { recipientIds?: string[]; recipients?: string[] };
export type MemberOption = { id: string; displayName: string; status: string };

export type WorkflowNodeConfig =
  | TriggerConfig
  | ConditionConfig
  | GetDataConfig
  | AddDataConfig
  | ActionConfig
  | AssigneeConfig
  | CopyConfig;

export type WorkflowNodeData = WorkflowNodeDataBase<
  WorkflowNodeKind,
  WorkflowNodeConfig
>;

export type WorkflowNode = WorkflowGraphNode<WorkflowNodeKind, WorkflowNodeConfig>;
export type PaletteNodeKind = Exclude<WorkflowNodeKind, "trigger">;
export type NodeMenuItem = {
  kind: PaletteNodeKind;
  label: string;
  description: string;
  group: string;
};
export type WorkflowEdgeData = {
  onInsert?: (sourceId: string, targetId: string, edgeId: string) => void;
  [key: string]: unknown;
};
export type WorkflowEdge = WorkflowGraphEdge<WorkflowEdgeData>;

export type FlowState = {
  flowType: "trigger" | "process";
  name: string;
  description: string;
  status: AutomationStatus;
  currentVersion?: number;
  triggerFormUuid: string;
  triggerEvent: TriggerEvent;
  triggerEvents: TriggerEvent[];
  triggerConfig: TriggerConfig;
  createdAt?: string;
  updatedAt?: string;
};

export type InsertContext = {
  sourceId: string;
  sourceHandle?: string | null;
  targetId?: string;
  edgeId?: string;
  position?: { x: number; y: number };
};

export const triggerEventRows: Array<{ label: string; events: TriggerEvent[] }> = [
  { label: "创建成功", events: ["before_create", "after_create"] },
  { label: "编辑成功", events: ["before_update", "after_update"] },
  { label: "删除成功", events: ["before_delete", "after_delete"] },
];

export const triggerDataNodeMenu: Array<{ group: string; items: NodeMenuItem[] }> =
  automationWorkflowPaletteGroups.map((group) => ({
    group: group.group,
    items: group.items
      .filter((item) => item.kind !== "trigger")
      .map((item) => ({
        kind: item.kind as PaletteNodeKind,
        label: item.label,
        description: item.description,
        group: item.group,
      })),
  }));

export const processDataNodeMenu: Array<{ group: string; items: NodeMenuItem[] }> =
  processWorkflowPaletteGroups.map((group) => ({
    group: group.group,
    items: group.items
      .filter((item) => item.kind !== "trigger")
      .map((item) => ({
        kind: item.kind as PaletteNodeKind,
        label: item.label,
        description: item.description,
        group: item.group,
      })),
  }));

export const placeholderNodeGroups = [
  {
    group: "消息节点",
    items: ["消息通知", "发送邮件"],
  },
  {
    group: "人工节点",
    items: ["发起审批"],
  },
];

export const branchOperators: Array<{ id: BranchRuleOperator; label: string }> = [
  { id: "eq", label: "等于" },
  { id: "neq", label: "不等于" },
  { id: "inAny", label: "等于任意一个" },
  { id: "notInAny", label: "不等于任意一个" },
  { id: "hasValue", label: "有值" },
  { id: "noValue", label: "无值" },
];

export const nodeTone: Record<WorkflowNodeKind, string> = {
  trigger: "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  condition: "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  "add-data": "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]",
  "update-data": "border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  "get-one": "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "get-many": "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "delete-data": "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  "http-request": "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  approval: "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  copy: "border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  executor: "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]",
  end: "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
};

export function workflowNodeWidth(node: WorkflowNode) {
  return node.data.kind === "condition" ? 310 : 250;
}

export function defaultNodeTemplate(kind: WorkflowNodeKind): WorkflowNodeData {
  switch (kind) {
    case "trigger":
      return {
        kind,
        label: "表单事件触发",
        description: "根据表单记录事件开始执行工作流",
        config: {
          changedFieldMode: "any",
          changedFieldId: "",
        } satisfies TriggerConfig,
      };
    case "condition":
      return {
        kind,
        label: "条件分支",
        description: "按优先级和条件规则控制后续走向",
        config: {
          branches: [createConditionBranch(1)],
        } satisfies ConditionConfig,
      };
    case "add-data":
      return {
        kind,
        label: "新增数据",
        description: "向目标表单新增单条或多条数据",
        config: {
          targetMode: "form",
          targetFormUuid: "",
          recordMode: "single",
          rows: [],
          multipleSourceMode: "data-node",
          multipleSourceNodeId: "",
          multipleFormula: "",
        } satisfies AddDataConfig,
      };
    case "update-data":
      return {
        kind,
        label: "更新数据",
        description: "根据匹配条件更新目标表单记录",
        config: {
          updateMode: "form",
          sourceNodeId: "",
          targetFormUuid: "",
          rules: [],
          matchRule: "",
          rows: [],
          bodyTemplate: "",
        } satisfies ActionConfig,
      };
    case "get-one":
      return {
        kind,
        label: "获取单条数据",
        description: "从表单、数据节点或关联表单中获取一条数据",
        config: {
          sourceMode: "form",
          formUuid: "",
          dataNodeId: "",
          relatedFormPlaceholder: "",
          filterExpression: "",
          fieldSelection: "",
        } satisfies GetDataConfig,
      };
    case "get-many":
      return {
        kind,
        label: "获取多条数据",
        description: "从表单、数据节点或关联表单中获取多条数据",
        config: {
          sourceMode: "form",
          formUuid: "",
          dataNodeId: "",
          relatedFormPlaceholder: "",
          filterExpression: "",
          fieldSelection: "",
        } satisfies GetDataConfig,
      };
    case "delete-data":
      return {
        kind,
        label: "删除数据",
        description: "按匹配条件删除目标表单数据",
        config: {
          targetFormUuid: "",
          matchRule: "",
        } satisfies ActionConfig,
      };
    case "http-request":
      return {
        kind,
        label: "连接器",
        description: "调用外部 HTTP 接口或 Webhook",
        config: {
          method: "POST",
          url: "",
          headersText: "",
          bodyTemplate: "",
        } satisfies ActionConfig,
      };
    case "approval":
      return { kind, label: "审批人", description: "等待审批人同意或拒绝", config: { assigneeIds: [], approvalMode: "all" } satisfies AssigneeConfig };
    case "copy":
      return { kind, label: "抄送人", description: "通知抄送人后自动继续", config: { recipientIds: [] } satisfies CopyConfig };
    case "executor":
      return { kind, label: "执行人", description: "等待执行人完成处理", config: { assigneeIds: [] } satisfies AssigneeConfig };
    case "end":
      return { kind, label: "结束", description: "完成审批流程", config: {} };
  }
}

export function createEditorEdge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): WorkflowEdge {
  return {
    id: `edge-${source}-${sourceHandle ?? "default"}-${target}-${Date.now()}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "insertable",
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    style: {
      stroke: "var(--color-primary)",
      strokeWidth: 1.4,
    },
  };
}

export function decorateEdges(
  edges: WorkflowEdge[],
  onInsert: (sourceId: string, targetId: string, edgeId: string) => void,
) {
  return edges.map((edge) => {
    if (edge.type === "insertable" && edge.data?.onInsert === onInsert) {
      return edge;
    }
    return {
      ...edge,
      type: "insertable",
      data: {
        ...edge.data,
        onInsert,
      },
    };
  });
}

export function normalizeWorkflowNodes(rawNodes: unknown): WorkflowNode[] {
  if (!Array.isArray(rawNodes)) return [];
  return rawNodes.flatMap((item, index) => {
    const rawData = isRecord(item.data) ? item.data : {};
    const kind = normalizeNodeKind(rawData.kind);
    if (!kind) {
      return [];
    }

    const normalizedKind = kind === "create-record"
      ? "add-data"
      : kind === "update-record"
        ? "update-data"
        : kind === "delete-record"
          ? "delete-data"
          : kind;

    const template = defaultNodeTemplate(normalizedKind);
    return [
      {
        id: readStringValue(item.id) || `${normalizedKind}-${index + 1}`,
        type: "workflow",
        position: normalizePosition(item.position, index),
        data: {
          kind: normalizedKind,
          label: readStringValue(rawData.label) || template.label,
          description: readStringValue(rawData.description) || template.description,
          config: normalizeNodeConfigByKind(normalizedKind, rawData.config),
        },
      },
    ];
  });
}

export function normalizeWorkflowEdges(rawEdges: unknown): WorkflowEdge[] {
  if (!Array.isArray(rawEdges)) return [];
  return rawEdges.flatMap((item, index) => {
    const source = readStringValue(item.source);
    const target = readStringValue(item.target);
    if (!source || !target) {
      return [];
    }

    return [
      {
        id: readStringValue(item.id) || `edge-${index + 1}`,
        source,
        target,
        sourceHandle: readStringValue(item.sourceHandle) || null,
        targetHandle: readStringValue(item.targetHandle) || null,
        type: "insertable",
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
        style: {
          stroke: "var(--color-primary)",
          strokeWidth: 1.4,
        },
      },
    ];
  });
}

export function migrateConditionEdgeHandles(edges: WorkflowEdge[], nodes: WorkflowNode[]) {
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    if (edge.sourceHandle) {
      return edge;
    }
    const sourceNode = nodeLookup.get(edge.source);
    const sourceHandle = sourceNode ? defaultSourceHandleForNode(sourceNode) : null;
    return sourceHandle ? { ...edge, sourceHandle } : edge;
  });
}

export function defaultSourceHandleForNode(node: WorkflowNode) {
  if (node.data.kind !== "condition") {
    return null;
  }
  const firstBranch = normalizeConditionConfig(node.data.config).branches?.[0];
  return firstBranch ? conditionBranchHandleId(firstBranch.id) : null;
}

export function ensureTriggerNode(
  nodes: WorkflowNode[],
  flowState: FlowState,
  forms: ApiFormSummary[],
) {
  if (nodes.some((node) => node.data.kind === "trigger")) {
    return syncTriggerNode(nodes, flowState, forms);
  }

  return [createTriggerNode(flowState, forms), ...nodes];
}

export function createTriggerNode(flowState: FlowState, forms: ApiFormSummary[]): WorkflowNode {
  return {
    id: "trigger-1",
    type: "workflow",
    position: { x: 120, y: 200 },
    data: buildTriggerNodeData(flowState, forms),
  };
}

export function syncTriggerNode(nodes: WorkflowNode[], flowState: FlowState, forms: ApiFormSummary[]) {
  return nodes.map((node) =>
    node.data.kind === "trigger"
      ? {
          ...node,
          data: buildTriggerNodeData(flowState, forms),
        }
      : node,
  );
}

export function buildTriggerNodeData(flowState: FlowState, forms: ApiFormSummary[]): WorkflowNodeData {
  const formName =
    forms.find((form) => form.id === flowState.triggerFormUuid)?.name ?? "未配置表单";
  const eventLabel = flowState.flowType === "process"
    ? "表单提交时"
    : flowState.triggerEvents
        .map((event) => triggerEvents.find((item) => item.id === event)?.label ?? event)
        .join("、");

  return {
    kind: "trigger",
    label: flowState.flowType === "process" ? "表单提交时" : "表单事件触发",
    description: `${formName} / ${eventLabel}`,
    config: {
      changedFieldMode: flowState.triggerConfig.changedFieldMode ?? "any",
      changedFieldId: flowState.triggerConfig.changedFieldId ?? "",
    },
  };
}

export function buildAutomationName(
  forms: ApiFormSummary[],
  formUuid: string,
) {
  return forms.find((form) => form.id === formUuid)?.name ?? "未命名自动化";
}

export function serializeWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return serializeWorkflowGraph(nodes, edges);
}

export function normalizeFormSchema(schema: Record<string, unknown>): FormSchemaDescriptor {
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return {
    formUuid: readStringValue(schema.formUuid),
    formName: readStringValue(schema.formName),
    fields: fields
      .map((item) => normalizeSchemaField(item))
      .filter((item): item is FormFieldDescriptor => item !== null),
  };
}

export function normalizeSchemaField(value: unknown): FormFieldDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }

  const props = isRecord(value.props) ? value.props : {};
  const options = Array.isArray(props.options)
    ? props.options
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }
          const label = readStringValue(item.label);
          const optionValue = readStringValue(item.value);
          if (!label || !optionValue) {
            return null;
          }
          return { label, value: optionValue };
        })
        .filter((item): item is FieldOption => item !== null)
    : [];

  const fieldType = readStringValue(value.type);
  if (!fieldType || fieldType === "groupContainer" || fieldType === "button") {
    return null;
  }

  return {
    id: readStringValue(value.id),
    label: readStringValue(value.label),
    type: fieldType,
    isRequired: props.isRequired === true,
    options,
  };
}

export function collectSchemaTargets(flowState: FlowState, nodes: WorkflowNode[]) {
  const targetSet = new Set<string>();
  if (flowState.triggerFormUuid) {
    targetSet.add(flowState.triggerFormUuid);
  }
  for (const node of nodes) {
    if (node.data.kind === "add-data" || node.data.kind === "update-data" || node.data.kind === "delete-data") {
      const formUuid = readStringValue((node.data.config as ActionConfig).targetFormUuid);
      if (formUuid) {
        targetSet.add(formUuid);
      }
    }
    if (node.data.kind === "get-one" || node.data.kind === "get-many") {
      const formUuid = readStringValue((node.data.config as GetDataConfig).formUuid);
      if (formUuid) {
        targetSet.add(formUuid);
      }
    }
  }
  return [...targetSet];
}

export function buildSourceFieldChoices({
  currentNodeId,
  edges,
  formSchemas,
  flowState,
  nodes,
}: {
  currentNodeId: string | null;
  edges: WorkflowEdge[];
  formSchemas: Record<string, FormSchemaDescriptor>;
  flowState: FlowState;
  nodes: WorkflowNode[];
}) {
  const upstreamIds = collectUpstreamNodeIds(edges, currentNodeId);
  const orderedNodes = nodes.filter((node) => upstreamIds.has(node.id));
  const choices: SourceFieldChoice[] = [];

  for (const node of orderedNodes) {
    const schema = getSchemaForSourceNode(node, formSchemas, flowState);
    if (!schema) {
      continue;
    }

    const nodeLabel = node.data.label || node.id;
    for (const field of schema.fields) {
      choices.push({
        key: `${node.id}:${field.id}`,
        label: `${nodeLabel}.${field.label}`,
        fieldType: field.type,
        options: field.options,
      });
    }
  }

  return choices;
}

export function buildGetManySourceOptions(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  currentNodeId: string | null,
) {
  const upstreamIds = collectUpstreamNodeIds(edges, currentNodeId);
  return nodes
    .filter((node) => upstreamIds.has(node.id) && node.data.kind === "get-many")
    .map((node) => ({
      id: node.id,
      label: node.data.label || node.id,
      description: node.data.description || "获取多条数据",
    }));
}

export function buildQueryNodeOptions(nodes: WorkflowNode[]) {
  return nodes
    .filter((node) => node.data.kind === "get-one" || node.data.kind === "get-many")
    .map((node) => ({
      id: node.id,
      label: node.data.label || node.id,
      description:
        node.data.description ||
        (node.data.kind === "get-one" ? "获取单条数据" : "获取多条数据"),
    }));
}

export function buildUpdateTargetFormOptions(
  forms: ApiFormSummary[],
  detailForms: ApiDetailForm[],
) {
  const mainFormNames = new Map(
    forms
      .filter((form) => form.formType !== "detail")
      .map((form) => [form.id, form.name]),
  );
  const detailFormLabels = new Map(
    detailForms.map((detail) => [
      detail.detailFormUuid,
      `${mainFormNames.get(detail.sourceFormUuid) ?? "表单"}.${detail.title}`,
    ]),
  );

  return forms.map((form) => ({
    id: form.id,
    label: detailFormLabels.get(form.id) ?? form.name,
  }));
}

export function collectUpstreamNodeIds(edges: WorkflowEdge[], currentNodeId: string | null) {
  const upstreamIds = new Set<string>();
  if (!currentNodeId) {
    return upstreamIds;
  }

  const pending = [currentNodeId];
  while (pending.length > 0) {
    const targetId = pending.shift();
    if (!targetId) {
      continue;
    }

    for (const edge of edges) {
      if (edge.target !== targetId || upstreamIds.has(edge.source)) {
        continue;
      }
      upstreamIds.add(edge.source);
      pending.push(edge.source);
    }
  }
  return upstreamIds;
}

export function buildDataNodeFieldChoices({
  formSchemas,
  nodeId,
  nodes,
}: {
  formSchemas: Record<string, FormSchemaDescriptor>;
  nodeId: string;
  nodes: WorkflowNode[];
}) {
  const sourceNode = nodes.find((node) => node.id === nodeId && node.data.kind === "get-many");
  if (!sourceNode) {
    return [];
  }

  const config = normalizeGetDataConfig(sourceNode.data.config);
  const schema = config.formUuid ? formSchemas[config.formUuid] : undefined;
  if (!schema) {
    return [];
  }

  return schema.fields.map((field) => ({
    key: `${sourceNode.id}:${field.id}`,
    label: `${sourceNode.data.label || sourceNode.id}.${field.label}`,
    fieldType: field.type,
    options: field.options,
  }));
}

export function getSchemaForNodeTarget(
  node: WorkflowNode,
  formSchemas: Record<string, FormSchemaDescriptor>,
) {
  const targetFormUuid =
    readStringValue((node.data.config as AddDataConfig | ActionConfig).targetFormUuid);
  return targetFormUuid ? formSchemas[targetFormUuid] : undefined;
}

export function getSchemaFields(
  formUuid: string | undefined,
  formSchemas: Record<string, FormSchemaDescriptor>,
) {
  return formUuid ? formSchemas[formUuid]?.fields ?? [] : [];
}

export function createFieldMappingRow(fieldId: string): FieldMappingRow {
  return {
    id: `row-${fieldId}-${Date.now()}`,
    fieldId,
    valueType: "value",
    rawValue: "",
    sourceFieldKey: "",
    formula: "",
  };
}

export function createBranchRule(parentId?: string): BranchRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    logicalOperator: "and",
    fieldKey: "",
    operator: "eq",
    rawValue: "",
    valueType: "value",
    sourceFieldKey: "",
  };
}

export function promoteRuleToChildGroup(rules: BranchRule[], ruleId: string): BranchRule[] {
  const index = rules.findIndex((rule) => rule.id === ruleId);
  const target = rules[index];
  if (!target || target.isGroup) return rules;

  const movedRule = {
    ...target,
    id: createBranchRule(target.id).id,
    parentId: target.id,
    logicalOperator: "and" as const,
    isGroup: false,
  };
  const newRule = createBranchRule(target.id);
  const group: BranchRule = {
    id: target.id,
    parentId: target.parentId,
    logicalOperator: target.logicalOperator ?? "and",
    isGroup: true,
  };

  return [...rules.slice(0, index), group, movedRule, newRule, ...rules.slice(index + 1)];
}

export function createConditionBranch(priority: number): ConditionBranch {
  return {
    id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `条件分支 ${priority}`,
    mode: "all",
    priority,
    rules: [],
    expression: "",
    hitLabel: "",
  };
}

export function conditionBranchHandleId(branchId: string) {
  return `condition-branch:${branchId}`;
}

export function syncRequiredRows(rows: FieldMappingRow[], fields: FormFieldDescriptor[]) {
  const nextRows = [...rows];
  for (const field of fields.filter((item) => item.isRequired)) {
    if (!nextRows.some((row) => row.fieldId === field.id)) {
      nextRows.push(createFieldMappingRow(field.id));
    }
  }
  return nextRows;
}

export function normalizePosition(value: unknown, index: number) {
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y };
  }

  return { x: 340 + index * 30, y: 200 + index * 36 };
}

export function normalizeNodeKind(value: unknown): WorkflowNodeKind | "create-record" | "update-record" | "delete-record" | null {
  if (
    value === "trigger" ||
    value === "condition" ||
    value === "add-data" ||
    value === "update-data" ||
    value === "get-one" ||
    value === "get-many" ||
    value === "delete-data" ||
    value === "http-request" ||
    value === "approval" ||
    value === "copy" ||
    value === "executor" ||
    value === "end" ||
    value === "create-record" ||
    value === "update-record" ||
    value === "delete-record"
  ) {
    return value;
  }
  return null;
}

export function normalizeNodeConfigByKind(kind: WorkflowNodeKind, value: unknown): WorkflowNodeConfig {
  switch (kind) {
    case "trigger":
      return normalizeTriggerConfig(value);
    case "condition":
      return normalizeConditionConfig(value);
    case "get-one":
    case "get-many":
      return normalizeGetDataConfig(value);
    case "add-data":
      return normalizeAddDataConfig(value);
    case "update-data":
    case "delete-data":
    case "http-request":
      return normalizeActionConfig(value);
    case "approval":
    case "executor":
      return normalizeAssigneeConfig(value);
    case "copy":
      return normalizeCopyConfig(value);
    case "end":
      return {};
  }
}

export function normalizeTriggerConfig(value: unknown): TriggerConfig {
  const current = isRecord(value) ? value : {};
  const legacyFieldId = readStringValue(current.changedFieldsText);
  const changedFieldId = readStringValue(current.changedFieldId) || legacyFieldId;
  return {
    changedFieldMode:
      current.changedFieldMode === "specific" || changedFieldId ? "specific" : "any",
    changedFieldId,
    changedFieldsText: legacyFieldId,
  };
}

export function normalizeConditionConfig(value: unknown): ConditionConfig {
  const current = isRecord(value) ? value : {};
  const rawBranches = Array.isArray(current.branches) ? current.branches : [];

  if (rawBranches.length > 0) {
    return {
      branches: rawBranches.map((item, index) => normalizeConditionBranch(item, index)),
    };
  }

  const legacyBranch = normalizeConditionBranch(
    {
      id: "branch-legacy-1",
      name: current.name,
      mode: current.mode,
      priority: current.priority,
      rules: current.rules,
      expression: current.expression,
      hitLabel: current.hitLabel,
    },
    0,
  );

  return {
    branches: [legacyBranch],
  };
}

export function normalizeConditionBranch(value: unknown, index: number): ConditionBranch {
  const current = isRecord(value) ? value : {};
  const rawRules = Array.isArray(current.rules) ? current.rules : [];
  return {
    id: readStringValue(current.id) || `branch-${index + 1}`,
    name: readStringValue(current.name) || `条件分支 ${index + 1}`,
    mode:
      current.mode === "rules" || current.mode === "expression" || current.mode === "all"
        ? current.mode
        : "all",
    priority:
      typeof current.priority === "number" && Number.isFinite(current.priority)
        ? Math.max(1, current.priority)
        : index + 1,
    rules: rawRules
      .map((item) => normalizeBranchRule(item))
      .filter((item): item is BranchRule => item !== null),
    expression: readStringValue(current.expression),
    hitLabel: readStringValue(current.hitLabel),
  };
}

export function normalizeBranchRule(value: unknown): BranchRule | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readStringValue(value.id) || `rule-${Date.now()}`;
  const operator = normalizeBranchRuleOperator(value.operator);
  return {
    id,
    parentId: readStringValue(value.parentId) || undefined,
    logicalOperator: value.logicalOperator === "or" ? "or" : "and",
    isGroup: value.isGroup === true,
    fieldKey: readStringValue(value.fieldKey),
    operator,
    rawValue: readStringValue(value.rawValue),
    valueType: value.valueType === "field" ? "field" : "value",
    sourceFieldKey: readStringValue(value.sourceFieldKey),
  };
}

export function normalizeGetDataConfig(value: unknown): GetDataConfig {
  const current = isRecord(value) ? value : {};
  return {
    sourceMode: normalizeSourceMode(current.sourceMode),
    formUuid: readStringValue(current.formUuid),
    dataNodeId: readStringValue(current.dataNodeId),
    relatedFormPlaceholder: readStringValue(current.relatedFormPlaceholder),
    filterExpression: readStringValue(current.filterExpression),
    fieldSelection: readStringValue(current.fieldSelection),
  };
}

export function normalizeAddDataConfig(value: unknown): AddDataConfig {
  const current = isRecord(value) ? value : {};
  const rawRows = Array.isArray(current.rows) ? current.rows : [];
  return {
    targetMode: normalizeTargetMode(current.targetMode),
    targetFormUuid: readStringValue(current.targetFormUuid),
    recordMode: normalizeRecordMode(current.recordMode),
    rows: rawRows
      .map((item) => normalizeFieldMappingRow(item))
      .filter((item): item is FieldMappingRow => item !== null),
    multipleSourceMode:
      current.multipleSourceMode === "form" ? "form" : "data-node",
    multipleSourceNodeId: readStringValue(current.multipleSourceNodeId),
    multipleFormula: readStringValue(current.multipleFormula),
  };
}

export function normalizeActionConfig(value: unknown): ActionConfig {
  const current = isRecord(value) ? value : {};
  const rawRows = Array.isArray(current.rows) ? current.rows : [];
  const rawRules = Array.isArray(current.rules) ? current.rules : [];
  return {
    updateMode: normalizeUpdateMode(current.updateMode),
    sourceNodeId: readStringValue(current.sourceNodeId),
    targetFormUuid: readStringValue(current.targetFormUuid),
    rules: rawRules
      .map((item) => normalizeBranchRule(item))
      .filter((item): item is BranchRule => item !== null),
    matchRule: readStringValue(current.matchRule),
    rows: rawRows
      .map((item) => normalizeFieldMappingRow(item))
      .filter((item): item is FieldMappingRow => item !== null),
    bodyTemplate: readStringValue(current.bodyTemplate),
    method: readStringValue(current.method),
    url: readStringValue(current.url),
    headersText: readStringValue(current.headersText),
  };
}

export function normalizeAssigneeConfig(value: unknown): AssigneeConfig {
  const current = isRecord(value) ? value : {};
  return {
    assigneeIds: Array.isArray(current.assigneeIds) ? current.assigneeIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : Array.isArray(current.assignees) ? current.assignees.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    approvalMode: current.approvalMode === "any" ? "any" : "all",
  };
}

export function normalizeCopyConfig(value: unknown): CopyConfig {
  const current = isRecord(value) ? value : {};
  return { recipientIds: Array.isArray(current.recipientIds) ? current.recipientIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : Array.isArray(current.recipients) ? current.recipients.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [] };
}

export function normalizeFieldMappingRow(value: unknown): FieldMappingRow | null {
  if (!isRecord(value)) {
    return null;
  }
  const fieldId = readStringValue(value.fieldId);
  if (!fieldId) {
    return null;
  }
  return {
    id: readStringValue(value.id) || `row-${fieldId}-${Date.now()}`,
    fieldId,
    valueType: normalizeValueType(value.valueType),
    rawValue: readStringValue(value.rawValue),
    sourceFieldKey: readStringValue(value.sourceFieldKey),
    formula: readStringValue(value.formula),
  };
}

export function normalizeSourceMode(value: unknown): DataSourceMode {
  return value === "data-node" || value === "related-form" ? value : "form";
}

export function normalizeTargetMode(value: unknown): AddTargetMode {
  return value === "subtable" ? "subtable" : "form";
}

export function normalizeRecordMode(value: unknown): AddRecordMode {
  return value === "multiple" ? "multiple" : "single";
}

export function normalizeUpdateMode(value: unknown): UpdateMode {
  return value === "data-node" ? "data-node" : "form";
}

export function normalizeValueType(value: unknown): FieldValueType {
  return value === "field" || value === "formula" ? value : "value";
}

export function normalizeBranchRuleOperator(value: unknown): BranchRuleOperator {
  return value === "neq" ||
    value === "inAny" ||
    value === "notInAny" ||
    value === "hasValue" ||
    value === "noValue"
    ? value
    : "eq";
}

export function readStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nodeKindLabel(kind: WorkflowNodeKind) {
  switch (kind) {
    case "trigger":
      return "触发器";
    case "condition":
      return "条件分支";
    case "add-data":
      return "新增数据";
    case "update-data":
      return "更新数据";
    case "get-one":
      return "获取单条数据";
    case "get-many":
      return "获取多条数据";
    case "delete-data":
      return "删除数据";
    case "http-request":
      return "连接器";
    case "approval":
      return "审批人";
    case "copy":
      return "抄送人";
    case "executor":
      return "执行人";
    case "end":
      return "结束";
  }
}

export function getSchemaForSourceNode(
  node: WorkflowNode,
  formSchemas: Record<string, FormSchemaDescriptor>,
  flowState: FlowState,
) {
  if (node.data.kind === "trigger") {
    return flowState.triggerFormUuid ? formSchemas[flowState.triggerFormUuid] : undefined;
  }

  if (node.data.kind === "get-one" || node.data.kind === "get-many") {
    const config = normalizeGetDataConfig(node.data.config);
    return config.formUuid ? formSchemas[config.formUuid] : undefined;
  }

  if (
    node.data.kind === "add-data" ||
    node.data.kind === "update-data" ||
    node.data.kind === "delete-data"
  ) {
    const config =
      node.data.kind === "add-data"
        ? normalizeAddDataConfig(node.data.config)
        : normalizeActionConfig(node.data.config);
    return config.targetFormUuid ? formSchemas[config.targetFormUuid] : undefined;
  }

  return undefined;
}

export function nodeSummary(data: WorkflowNodeData) {
  if (data.kind === "trigger") {
    const config = normalizeTriggerConfig(data.config);
    return config.changedFieldMode === "specific" && config.changedFieldId
      ? `指定字段: ${config.changedFieldId}`
      : "任意字段变更时执行";
  }
  if (data.kind === "condition") {
    const config = normalizeConditionConfig(data.config);
    return `${config.branches?.length ?? 1} 个条件分支`;
  }
  if (data.kind === "get-one" || data.kind === "get-many") {
    const config = normalizeGetDataConfig(data.config);
    return getSourceModeLabel(config.sourceMode ?? "form");
  }
  if (data.kind === "add-data") {
    const config = normalizeAddDataConfig(data.config);
    return config.recordMode === "multiple" ? "新增多条数据" : "新增单条数据";
  }
  if (data.kind === "http-request") {
    const config = normalizeActionConfig(data.config);
    return config.url || "未配置请求地址";
  }
  const config = normalizeActionConfig(data.config);
  return config.targetFormUuid || "未配置目标表单";
}

export function conditionBranchSummary(branch: ConditionBranch) {
  if (branch.mode === "all") {
    return "全部通过";
  }
  if (branch.mode === "rules") {
    return `${branch.rules.length} 条规则`;
  }
  return branch.expression || "未配置分支表达式";
}

export function getSourceModeLabel(mode: DataSourceMode) {
  if (mode === "data-node") {
    return "从数据节点获取";
  }
  if (mode === "related-form") {
    return "从关联表单获取";
  }
  return "从表单获取";
}

export function isUpdateTriggerEvent(event: TriggerEvent) {
  return event === "before_update" || event === "after_update";
}

export function hasUpdateTriggerEvent(events: TriggerEvent[]) {
  return events.some((event) => isUpdateTriggerEvent(event));
}

export function orderTriggerEvents(events: TriggerEvent[]) {
  return triggerEventRows
    .flatMap((row) => row.events)
    .filter((event) => events.includes(event));
}

export function formatDateLabel(value?: string) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function valueTypeLabel(valueType: FieldValueType) {
  if (valueType === "field") {
    return "字段";
  }
  if (valueType === "formula") {
    return "公式";
  }
  return "值";
}

export function branchModeLabel(mode: "all" | "rules" | "expression") {
  if (mode === "rules") {
    return "按条件规则进入";
  }
  if (mode === "expression") {
    return "按表达式进入";
  }
  return "所有数据均可通过";
}

export function branchOperatorLabel(operator: BranchRuleOperator) {
  return branchOperators.find((item) => item.id === operator)?.label ?? "等于";
}

export function extractExpressionTokens(value: string) {
  const matches = value.matchAll(/\{\{([^}]+)\}\}/g);
  return [...matches]
    .map((match) => match[1]?.trim() ?? "")
    .filter((item) => item.length > 0);
}

export function fieldTypeMatches(sourceType: string, targetType: string | undefined) {
  if (!targetType) {
    return true;
  }

  const sourceGroup = normalizeFieldTypeGroup(sourceType);
  const targetGroup = normalizeFieldTypeGroup(targetType);
  return sourceGroup === targetGroup;
}

export function normalizeFieldTypeGroup(type: string) {
  if (type === "number") {
    return "number";
  }
  if (type === "date" || type === "dateRange") {
    return "date";
  }
  if (type === "select" || type === "radio") {
    return "single-choice";
  }
  if (type === "multiSelect" || type === "checkbox") {
    return "multi-choice";
  }
  if (type === "member") {
    return "member";
  }
  if (type === "department") {
    return "department";
  }
  return "text";
}
