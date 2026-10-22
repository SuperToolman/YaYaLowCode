import { MarkerType } from "@xyflow/react";
import type {
  ApiDetailForm,
  ApiFormSummary,
} from "@/features/automation-editor/api";
import {
  triggerEvents,
  type AutomationStatus,
  type TriggerEvent,
} from "../components/AutomationShared";
import {
  serializeWorkflowGraph,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
  type WorkflowNodeData as WorkflowNodeDataBase,
} from "@components/workflow-editor/workflow-core";
export type { FieldMappingRow } from "@/features/automation-editor/field-mapping";
export { createFieldMappingRow, normalizeFieldMappingRow, syncRequiredRows } from "@/features/automation-editor/field-mapping";
export type { BranchRule, BranchRuleOperator } from "@/features/automation-editor/condition-rules";
export { branchOperators, createBranchRule, normalizeBranchRule, normalizeBranchRuleOperator, promoteRuleToChildGroup } from "@/features/automation-editor/condition-rules";
import { branchOperators, createBranchRule, normalizeBranchRule, normalizeBranchRuleOperator, promoteRuleToChildGroup, type BranchRule, type BranchRuleOperator } from "@/features/automation-editor/condition-rules";
import { createFieldMappingRow, normalizeFieldMappingRow, syncRequiredRows, type FieldMappingRow } from "@/features/automation-editor/field-mapping";
import {
  BUILTIN_RECORD_FIELDS,
  WORKFLOW_BUILTIN_RECORD_FIELDS,
} from "@/features/records/model/excel-association";

export type WorkflowNodeKind =
  | "trigger"
  | "condition"
  | "parallel-condition"
  | "initiate-approval"
  | "add-data"
  | "update-data"
  | "get-one"
  | "get-many"
  | "delete-data"
  | "http-request"
  | "approval"
  | "copy"
  | "executor";

export type FieldValueType = import("@/features/automation-editor/field-mapping").FieldValueType;
export type DataSourceMode = "form" | "data-node" | "trigger";
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
  isSystem?: boolean;
};

export function buildRecordFieldChoices(fields: FormFieldDescriptor[], workflow = false): SourceFieldChoice[] {
  const systemFields = workflow ? [...BUILTIN_RECORD_FIELDS, ...WORKFLOW_BUILTIN_RECORD_FIELDS] : BUILTIN_RECORD_FIELDS;
  const reserved = new Set(systemFields.map((field) => field.id));
  return [
    ...fields.filter((field) => !reserved.has(field.id as typeof systemFields[number]["id"]))
      .map((field) => ({ key: field.id, label: field.label, fieldType: field.type, options: field.options })),
    ...systemFields.map((field) => ({
      key: field.id,
      label: field.id === "workflowSubmitter" ? "流程提交人" : field.label,
      fieldType: field.id === "createdAt" || field.id === "updatedAt" ? "date" : "singleLineText",
      options: [],
      isSystem: true,
    })),
  ];
}

export type FormFieldDescriptor = {
  id: string;
  label: string;
  type: string;
  parentGroupId?: string;
  isRequired: boolean;
  options: FieldOption[];
};

export type FormSchemaDescriptor = {
  formUuid: string;
  formName: string;
  fields: FormFieldDescriptor[];
};

/** 普通分组中的字段仍可填写；子表字段属于行数据，不作为单条草稿字段。 */
export function workflowDraftFields(schema?: FormSchemaDescriptor): FormFieldDescriptor[] {
  const fields = schema?.fields ?? [];
  return fields.filter((field) => {
    if (["subform", "groupContainer", "description", "html", "tsx", "button"].includes(field.type)) return false;
    let parent = field.parentGroupId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      const ancestor = fields.find((item) => item.id === parent);
      if (ancestor?.type === "subform") return false;
      parent = ancestor?.parentGroupId;
    }
    return true;
  });
}

export type TriggerConfig = {
  changedFieldMode?: "any" | "specific";
  changedFieldId?: string;
  // Used only to migrate existing saved configurations.
};

export type ConditionBranch = {
  id: string;
  name: string;
  mode: "all" | "rules" | "expression";
  priority: number;
  rules: BranchRule[];
  expression: string;
  entryMode: "condition" | "otherwise";
};

export type ConditionConfig = {
  branches?: ConditionBranch[];
};

type LegacyBranchRule = {
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

type LegacyBranchRuleOperator =
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
  filterMode?: "all" | "rules";
  rules?: BranchRule[];
};

type LegacyFieldMappingRow = {
  id: string;
  fieldId: string;
  valueType: FieldValueType;
  rawValue?: string;
  sourceFieldKey?: string;
  formula?: string;
};

export type AddDataConfig = {
  subformFieldId?: string;
  parentDataNodeId?: string;
  targetMode?: AddTargetMode;
  targetFormUuid?: string;
  recordMode?: AddRecordMode;
  rows?: FieldMappingRow[];
  multipleSourceMode?: "form" | "data-node";
  multipleSourceNodeId?: string;
  multipleFormula?: string;
};

export type InitiateApprovalConfig = {
  targetFormUuid?: string;
  targetAppId?: string;
  rows?: FieldMappingRow[];
  initiatorMode?: "member" | "field";
  initiatorId?: string;
  initiatorFieldId?: string;
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

export type AssigneeConfig = {
  assigneeIds?: string[];
  assigneeMode?: "self" | "members" | "roles";
  roleIds?: string[];
  approvalMode?: "all" | "any";
  requiredFieldIds?: string[];
};
export type CopyConfig = { recipientIds?: string[]; recipientMode?: "members" | "roles"; roleIds?: string[] };
export type MemberOption = { id: string; displayName: string; status: string; sourceType: string; avatarUrl?: string | null };
export type RoleOption = { id: string; name: string; status: string; sourceType: string };

export type WorkflowNodeConfig =
  | TriggerConfig
  | ConditionConfig
  | GetDataConfig
  | AddDataConfig
  | InitiateApprovalConfig
  | ActionConfig
  | AssigneeConfig
  | CopyConfig;

export type WorkflowNodeData = WorkflowNodeDataBase<
  WorkflowNodeKind,
  WorkflowNodeConfig
>;

export type WorkflowNode = WorkflowGraphNode<
  WorkflowNodeKind,
  WorkflowNodeConfig
>;
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

export const triggerEventRows: Array<{
  label: string;
  events: TriggerEvent[];
}> = [
  { label: "按钮触发", events: ["button_click"] },
  { label: "创建成功", events: ["before_create", "after_create"] },
  { label: "编辑成功", events: ["before_update", "after_update"] },
  { label: "删除成功", events: ["before_delete", "after_delete"] },
];

export { triggerDataNodeMenu, processDataNodeMenu } from "../components/AutomationWorkflowNodeRegistry";

export const placeholderNodeGroups = [
  {
    group: "消息节点",
    items: ["消息通知", "发送邮件"],
  },
];


export const nodeTone: Record<WorkflowNodeKind, string> = {
  "initiate-approval": "",
  trigger:
    "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "parallel-condition":
    "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  condition:
    "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  "add-data":
    "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]",
  "update-data":
    "border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  "get-one":
    "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "get-many":
    "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "delete-data":
    "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  "http-request":
    "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  approval:
    "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  copy: "border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  executor:
    "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]",
};

export function workflowNodeWidth(node: WorkflowNode) {
  return (node.data.kind === "condition" || node.data.kind === "parallel-condition") ? 310 : 250;
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
    case "parallel-condition":
    case "condition":
      return {
        kind,
        label: kind === "parallel-condition" ? "并行条件分支" : "条件分支",
        description: kind === "parallel-condition" ? "判断所有条件，并行执行满足条件的分支" : "按优先级和条件规则控制后续走向",
        config: {
          branches: [
            createConditionBranch(1),
            { ...createConditionBranch(2), id: `otherwise-${Date.now()}`, name: "否则", entryMode: "otherwise" },
          ],
        } satisfies ConditionConfig,
      };
    case "initiate-approval":
      return { kind, label: "发起审批", description: "填写流程表单，待用户手动提交", config: { targetFormUuid: "", targetAppId: "", rows: [], initiatorMode: "member", initiatorId: "", initiatorFieldId: "" } satisfies InitiateApprovalConfig };
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
          rows: [],
          bodyTemplate: "",
        } satisfies ActionConfig,
      };
    case "get-one":
      return {
        kind,
        label: "获取单条数据",
        description: "从表单或数据节点中获取一条数据",
        config: {
          sourceMode: "form",
          formUuid: "",
          dataNodeId: "",
          filterMode: "all",
          rules: [],
        } satisfies GetDataConfig,
      };
    case "get-many":
      return {
        kind,
        label: "获取多条数据",
        description: "从表单或数据节点中获取多条数据",
        config: {
          sourceMode: "form",
          formUuid: "",
          dataNodeId: "",
          filterMode: "all",
          rules: [],
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
      return {
        kind,
        label: "审批人",
        description: "等待审批人同意或拒绝",
        config: {
          assigneeIds: [],
          roleIds: [],
          assigneeMode: "self",
          approvalMode: "all",
        } satisfies AssigneeConfig,
      };
    case "copy":
      return {
        kind,
        label: "抄送人",
        description: "通知抄送人后自动继续",
        config: { recipientIds: [], recipientMode: "members", roleIds: [] } satisfies CopyConfig,
      };
    case "executor":
      return {
        kind,
        label: "执行人",
        description: "等待执行人完成处理",
        config: { assigneeMode: "members", assigneeIds: [], roleIds: [], approvalMode: "all", requiredFieldIds: [] } satisfies AssigneeConfig,
      };
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
    if (!kind) throw new Error(`节点类型 ${String(rawData.kind)} 不受支持，请重新配置`);
    const normalizedKind = kind;

    const template = defaultNodeTemplate(normalizedKind);
    return [
      {
        id: readStringValue(item.id) || `${normalizedKind}-${index + 1}`,
        type: "workflow",
        position: normalizePosition(item.position, index),
        data: {
          kind: normalizedKind,
          label: readStringValue(rawData.label) || template.label,
          description:
            readStringValue(rawData.description) || template.description,
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

export function migrateConditionEdgeHandles(
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
) {
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    if (edge.sourceHandle) {
      return edge;
    }
    const sourceNode = nodeLookup.get(edge.source);
    const sourceHandle = sourceNode
      ? defaultSourceHandleForNode(sourceNode)
      : null;
    return sourceHandle ? { ...edge, sourceHandle } : edge;
  });
}

export function defaultSourceHandleForNode(node: WorkflowNode) {
  if (node.data.kind !== "condition" && node.data.kind !== "parallel-condition") {
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

export function createTriggerNode(
  flowState: FlowState,
  forms: ApiFormSummary[],
): WorkflowNode {
  return {
    id: "trigger-1",
    type: "workflow",
    position: { x: 120, y: 200 },
    data: buildTriggerNodeData(flowState, forms),
  };
}

export function syncTriggerNode(
  nodes: WorkflowNode[],
  flowState: FlowState,
  forms: ApiFormSummary[],
) {
  return nodes.map((node) =>
    node.data.kind === "trigger"
      ? {
          ...node,
          data: buildTriggerNodeData(flowState, forms),
        }
      : node,
  );
}

export function buildTriggerNodeData(
  flowState: FlowState,
  forms: ApiFormSummary[],
): WorkflowNodeData {
  const formName = flowState.triggerEvents.includes("button_click")
    ? forms.find((form) => form.id === flowState.triggerFormUuid)?.name ?? "点击按钮的表单"
    : forms.find((form) => form.id === flowState.triggerFormUuid)?.name ?? "未配置表单";
  const eventLabel =
    flowState.flowType === "process"
      ? "表单提交时"
      : flowState.triggerEvents.includes("button_click")
        ? "按钮触发（使用点击表单的当前记录）"
        : flowState.triggerEvents
          .map(
            (event) =>
              triggerEvents.find((item) => item.id === event)?.label ?? event,
          )
          .join("、");

  return {
    kind: "trigger",
    label: flowState.flowType === "process" ? "表单提交时" : flowState.triggerEvents.includes("button_click") ? "按钮触发" : "表单事件触发",
    description: `${formName} / ${eventLabel}`,
    config: {
      changedFieldMode: flowState.triggerConfig.changedFieldMode ?? "any",
      changedFieldId: flowState.triggerConfig.changedFieldId ?? "",
    },
  };
}

export function buildAutomationName(forms: ApiFormSummary[], formUuid: string) {
  return forms.find((form) => form.id === formUuid)?.name ?? "未命名自动化";
}

export function serializeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
) {
  const graph = serializeWorkflowGraph(nodes, edges);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.data.kind === "parallel-condition"
      ? { ...node, data: { ...node.data, config: {
          branches: normalizeConditionConfig(node.data.config).branches?.map((branch) => {
            const saved: Partial<ConditionBranch> = { ...branch };
            delete saved.priority;
            return saved;
          }),
        } } }
      : node),
  };
}

export function normalizeFormSchema(
  schema: Record<string, unknown>,
): FormSchemaDescriptor {
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return {
    formUuid: readStringValue(schema.formUuid),
    formName: readStringValue(schema.formName),
    fields: fields
      .map((item) => normalizeSchemaField(item))
      .filter((item): item is FormFieldDescriptor => item !== null),
  };
}

export function normalizeSchemaField(
  value: unknown,
): FormFieldDescriptor | null {
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
    parentGroupId: readStringValue(value.parentGroupId),
    isRequired: props.isRequired === true,
    options,
  };
}

export function collectSchemaTargets(
  flowState: FlowState,
  nodes: WorkflowNode[],
) {
  const targetSet = new Set<string>();
  if (flowState.triggerFormUuid) {
    targetSet.add(flowState.triggerFormUuid);
  }
  for (const node of nodes) {
    if (
      node.data.kind === "initiate-approval" ||
      node.data.kind === "add-data" ||
      node.data.kind === "update-data" ||
      node.data.kind === "delete-data"
    ) {
      const formUuid = readStringValue(
        (node.data.config as ActionConfig).targetFormUuid,
      );
      if (formUuid) {
        targetSet.add(formUuid);
      }
    }
    if (node.data.kind === "get-one" || node.data.kind === "get-many") {
      const formUuid = readStringValue(
        (node.data.config as GetDataConfig).formUuid,
      );
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
    if (["approval", "executor", "copy"].includes(node.data.kind)) {
      for (const [key, label] of [["actor", "处理人"], ["result", "处理结果"], ["tasks", "任务明细"]]) {
        choices.push({ key: `${node.id}:${key}`, label: `${node.data.label || node.id}.${label}`, fieldType: "singleLineText", options: [] });
      }
      continue;
    }
    const schema = getSchemaForSourceNode(node, formSchemas, flowState, nodes);
    if (!schema) continue;
    const nodeLabel = node.data.label || node.id;
    for (const field of buildRecordFieldChoices(schema.fields, flowState.flowType === "process")) {
      choices.push({ ...field, key: `${node.id}:${field.key}`, label: `${nodeLabel}.${field.label}` });
    }
  }

  return choices;
}

export function buildGetSourceOptions(nodes: WorkflowNode[], edges: WorkflowEdge[], currentNodeId: string | null) {
  const upstream = collectUpstreamNodeIds(edges, currentNodeId);
  return nodes.filter((node) => node.id !== currentNodeId && upstream.has(node.id) &&
    ["trigger", "get-one", "get-many"].includes(node.data.kind)).map((node) => ({
      id: node.id,
      label: node.data.label || nodeKindLabel(node.data.kind),
      description: nodeKindLabel(node.data.kind),
    }));
}

export function validateGetNodeConfiguration(node: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[], formSchemas: Record<string, FormSchemaDescriptor>, flowState: FlowState): string | undefined {
  if (node.data.kind !== "get-one" && node.data.kind !== "get-many") return;
  const config = normalizeGetDataConfig(node.data.config);
  if (config.sourceMode === "data-node" && !buildGetSourceOptions(nodes, edges, node.id).some((item) => item.id === config.dataNodeId)) return "请选择当前节点之前的有效数据节点";
  if (config.sourceMode === "trigger" && !flowState.triggerEvents.includes("button_click")) return "仅按钮触发自动化可直接使用触发记录";
  if (config.sourceMode === "form" && !config.formUuid) return "请选择来源表单";
  const schema = getSchemaForSourceNode(node, formSchemas, flowState, nodes);
  if (!schema) return "来源表单结构不可用，请重新选择或重试加载";
  if (config.filterMode === "rules") {
    const allowedFields = new Set([
      ...(config.sourceMode === "trigger" && flowState.triggerEvents.includes("button_click") ? [] : schema.fields.map((field) => field.id)),
      ...BUILTIN_RECORD_FIELDS.map((field) => field.id),
      ...(flowState.flowType === "process" ? WORKFLOW_BUILTIN_RECORD_FIELDS.map((field) => field.id) : []),
    ]);
    const error = validateGetFilterRules(config.rules ?? [], allowedFields);
    if (error) return error;
  }
}

export function validateGetFilterRules(rules: BranchRule[], fieldIds?: Set<string>): string | undefined {
  if (!rules.length || !rules.some((rule) => !rule.isGroup)) return "按条件过滤至少需要一条有效规则";
  const ids = new Set(rules.map((rule) => rule.id));
  if (ids.size !== rules.length) return "筛选规则 ID 重复";
  for (const rule of rules) {
    if (!rule.id || (rule.parentId && !ids.has(rule.parentId))) return "筛选规则分组无效";
    const visited = new Set([rule.id]);
    let parent = rule.parentId;
    while (parent) {
      if (visited.has(parent)) return "筛选规则分组不能循环引用";
      visited.add(parent);
      parent = rules.find((item) => item.id === parent)?.parentId;
    }
    if (rule.isGroup) {
      if (!rules.some((item) => item.parentId === rule.id)) return "筛选条件组不能为空";
      continue;
    }
    if (!rule.fieldKey || (fieldIds && !fieldIds.has(rule.fieldKey))) return "请选择有效的筛选字段";
    if (!rule.operator || !branchOperators.some((item) => item.id === rule.operator)) return "请选择有效的筛选运算符";
    if (!["hasValue", "noValue"].includes(rule.operator) && !rule.rawValue?.trim()) return "请填写筛选值";
  }
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
    .filter(
      (node) => node.data.kind === "get-one" || node.data.kind === "get-many",
    )
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

export function collectUpstreamNodeIds(
  edges: WorkflowEdge[],
  currentNodeId: string | null,
) {
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
  triggerFormUuid = "",
}: {
  triggerFormUuid?: string;
  formSchemas: Record<string, FormSchemaDescriptor>;
  nodeId: string;
  nodes: WorkflowNode[];
}) {
  const sourceNode = nodes.find(
    (node) => node.id === nodeId && node.data.kind === "get-many",
  );
  if (!sourceNode) {
    return [];
  }

  const formUuid = getSourceFormUuid(sourceNode, nodes, triggerFormUuid);
  const schema = formSchemas[formUuid];
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
  const config = normalizeAddDataConfig(node.data.config);
  if (node.data.kind === "add-data" && config.targetMode === "subtable") {
    const parent = formSchemas[config.targetFormUuid ?? ""];
    if (!parent || !config.subformFieldId || !parent.fields.some((field) => field.id === config.subformFieldId && field.type === "subform")) return undefined;
    return { ...parent, fields: parent.fields.filter((field) => field.parentGroupId === config.subformFieldId && field.type !== "subform") };
  }
  const targetFormUuid = readStringValue(
    (node.data.config as AddDataConfig | ActionConfig).targetFormUuid,
  );
  return targetFormUuid ? formSchemas[targetFormUuid] : undefined;
}

export function getSchemaFields(
  formUuid: string | undefined,
  formSchemas: Record<string, FormSchemaDescriptor>,
) {
  return formUuid ? (formSchemas[formUuid]?.fields ?? []) : [];
}


export function createConditionBranch(priority: number): ConditionBranch {
  return {
    id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `条件分支 ${priority}`,
    mode: "all",
    priority,
    rules: [],
    expression: "",
    entryMode: "condition",
  };
}

export function conditionBranchHandleId(branchId: string) {
  return `condition-branch:${branchId}`;
}


export function normalizePosition(value: unknown, index: number) {
  if (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  ) {
    return { x: value.x, y: value.y };
  }

  return { x: 340 + index * 30, y: 200 + index * 36 };
}

export function normalizeNodeKind(
  value: unknown,
):
  WorkflowNodeKind | null {
  if (
    value === "trigger" ||
    value === "condition" ||
    value === "parallel-condition" ||
    value === "initiate-approval" ||
    value === "add-data" ||
    value === "update-data" ||
    value === "get-one" ||
    value === "get-many" ||
    value === "delete-data" ||
    value === "http-request" ||
    value === "approval" ||
    value === "copy" ||
    value === "executor"
  ) {
    return value;
  }
  return null;
}

export function normalizeNodeConfigByKind(
  kind: WorkflowNodeKind,
  value: unknown,
): WorkflowNodeConfig {
  switch (kind) {
    case "trigger":
      return normalizeTriggerConfig(value);
    case "parallel-condition":
    case "condition":
      return normalizeConditionConfig(value);
    case "get-one":
    case "get-many":
      return normalizeGetDataConfig(value);
    case "initiate-approval":
      return normalizeInitiateApprovalConfig(value);
    case "add-data":
      return normalizeAddDataConfig(value);
    case "update-data": {
      if (isRecord(value) && "matchRule" in value) throw new Error("更新节点旧 matchRule 配置不受支持");
      return normalizeActionConfig(value);
    }
    case "delete-data":
    case "http-request":
      return normalizeActionConfig(value);
    case "approval":
    case "executor":
      return normalizeAssigneeConfig(value);
    case "copy":
      return normalizeCopyConfig(value);
  }
}

export function normalizeTriggerConfig(value: unknown): TriggerConfig {
  const current = isRecord(value) ? value : {};
  if ("changedFieldsText" in current) throw new Error("旧触发字段配置不受支持，请重新配置");
  const changedFieldId = readStringValue(current.changedFieldId);
  return {
    changedFieldMode:
      current.changedFieldMode === "specific" || changedFieldId
        ? "specific"
        : "any",
    changedFieldId,

  };
}

export function normalizeConditionConfig(value: unknown): ConditionConfig {
  if (!isRecord(value) || !Array.isArray(value.branches)) {
    throw new Error("condition node requires branches configuration");
  }
  const branches = value.branches.map((item, index) => normalizeConditionBranch(item, index));
  if (branches.filter((branch) => branch.entryMode === "otherwise").length > 1) {
    throw new Error("条件分支只能配置一个否则进入项");
  }
  return { branches: [
    ...branches.filter((branch) => branch.entryMode !== "otherwise"),
    ...branches.filter((branch) => branch.entryMode === "otherwise"),
  ] };
}

export function changeConditionEntryMode(
  config: unknown,
  branchId: string,
  value: "all" | "rules" | "expression" | "otherwise",
): ConditionConfig {
  const current = normalizeConditionConfig(config);
  if (value === "otherwise" && current.branches?.some((branch) => branch.id !== branchId && branch.entryMode === "otherwise")) {
    return current;
  }
  const branches = current.branches?.map((branch) => branch.id !== branchId ? branch : {
    ...branch,
    entryMode: value === "otherwise" ? "otherwise" as const : "condition" as const,
    mode: value === "otherwise" ? "all" as const : value,
    rules: value === "rules" && branch.rules.length === 0 ? [createBranchRule()] : branch.rules,
  });
  const next = normalizeConditionConfig({ branches });
  return { branches: next.branches?.map((branch, index) => ({ ...branch, priority: index + 1 })) };
}

export function normalizeConditionBranch(
  value: unknown,
  index: number,
): ConditionBranch {
  if (!isRecord(value) || (value.entryMode !== "condition" && value.entryMode !== "otherwise")) {
    throw new Error("condition branch requires a valid entryMode");
  }
  const current = value;
  const rawRules = Array.isArray(current.rules) ? current.rules : [];
  return {
    id: readStringValue(current.id) || `branch-${index + 1}`,
    name: readStringValue(current.name) || `条件分支 ${index + 1}`,
    mode:
      current.mode === "rules" ||
      current.mode === "expression" ||
      current.mode === "all"
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
    entryMode: current.entryMode as "condition" | "otherwise",
  };
}


export function normalizeGetDataConfig(value: unknown): GetDataConfig {
  const current = isRecord(value) ? value : {};
  if (current.filterExpression != null && (typeof current.filterExpression !== "string" || current.filterExpression.trim())) {
    throw new Error("获取节点不再支持旧表达式筛选，请重新配置");
  }
  if (current.filterMode != null && current.filterMode !== "all" && current.filterMode !== "rules") {
    throw new Error("获取节点筛选方式无效");
  }
  return {
    sourceMode: normalizeSourceMode(current.sourceMode),
    formUuid: readStringValue(current.formUuid),
    dataNodeId: readStringValue(current.dataNodeId),
    filterMode: current.filterMode === "rules" ? "rules" : "all",
    rules: normalizeActionConfig({ rules: current.rules }).rules ?? [],
  };
}

export function normalizeAddDataConfig(value: unknown): AddDataConfig {
  const current = isRecord(value) ? value : {};
  const rawRows = Array.isArray(current.rows) ? current.rows : [];
  return {
    subformFieldId: readStringValue(current.subformFieldId),
    parentDataNodeId: readStringValue(current.parentDataNodeId),
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

export function normalizeInitiateApprovalConfig(value: unknown): InitiateApprovalConfig {
  const current = isRecord(value) ? value : {};
  return {
    targetFormUuid: readStringValue(current.targetFormUuid),
    targetAppId: readStringValue(current.targetAppId),
    rows: (Array.isArray(current.rows) ? current.rows : []).map(normalizeFieldMappingRow).filter((row): row is FieldMappingRow => row !== null),
    initiatorMode: current.initiatorMode === "field" ? "field" : "member",
    initiatorId: readStringValue(current.initiatorId),
    initiatorFieldId: readStringValue(current.initiatorFieldId),
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
    ...("matchRule" in current ? { matchRule: readStringValue(current.matchRule) } : {}),
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
    assigneeIds: Array.isArray(current.assigneeIds)
      ? current.assigneeIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
    assigneeMode:
      current.assigneeMode === "self" || current.assigneeMode === "roles" || current.assigneeMode === "members"
        ? current.assigneeMode
        : undefined,
    roleIds: Array.isArray(current.roleIds)
      ? current.roleIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    approvalMode: current.approvalMode === "any" ? "any" : "all",
    requiredFieldIds: Array.isArray(current.requiredFieldIds)
      ? current.requiredFieldIds.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [],
  };
}

export function normalizeCopyConfig(value: unknown): CopyConfig {
  const current = isRecord(value) ? value : {};
  return {
    recipientIds: Array.isArray(current.recipientIds)
      ? current.recipientIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
    recipientMode: current.recipientMode === "roles" || current.recipientMode === "members"
      ? current.recipientMode
      : undefined,
    roleIds: Array.isArray(current.roleIds)
      ? current.roleIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [],
  };
}


export function normalizeSourceMode(value: unknown): DataSourceMode {
  if (value != null && value !== "form" && value !== "data-node" && value !== "trigger") {
    throw new Error("获取节点的数据来源仅支持表单或数据节点");
  }
  return value === "data-node" || value === "trigger" ? value : "form";
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
    case "parallel-condition":
      return "并行条件分支";
    case "condition":
      return "条件分支";
    case "initiate-approval":
      return "发起审批";
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
  }
}

export function getSourceFormUuid(node: WorkflowNode, nodes: WorkflowNode[], triggerFormUuid: string): string {
  const visited = new Set<string>();
  let current: WorkflowNode | undefined = node;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.data.kind === "trigger") return triggerFormUuid;
    if (!["get-one", "get-many"].includes(current.data.kind)) return "";
    const config = normalizeGetDataConfig(current.data.config);
    if (config.sourceMode === "trigger") return triggerFormUuid;
    if (config.sourceMode === "form") return config.formUuid ?? "";
    current = nodes.find((item) => item.id === config.dataNodeId);
  }
  return "";
}

export function getSchemaForSourceNode(
  node: WorkflowNode,
  formSchemas: Record<string, FormSchemaDescriptor>,
  flowState: FlowState,
  nodes: WorkflowNode[] = [],
  visited = new Set<string>(),
): FormSchemaDescriptor | undefined {
  if (visited.has(node.id)) return undefined;
  visited.add(node.id);
  if (node.data.kind === "trigger") {
    return flowState.triggerFormUuid ? formSchemas[flowState.triggerFormUuid] : undefined;
  }

  if (node.data.kind === "get-one" || node.data.kind === "get-many") {
    const config = normalizeGetDataConfig(node.data.config);
    if (config.sourceMode === "trigger") {
      return flowState.triggerFormUuid ? formSchemas[flowState.triggerFormUuid] : undefined;
    }
    if (config.sourceMode === "data-node") {
      const source = nodes.find((item) => item.id === config.dataNodeId);
      return source ? getSchemaForSourceNode(source, formSchemas, flowState, nodes, visited) : undefined;
    }
    return config.formUuid ? formSchemas[config.formUuid] : undefined;
  }

  if (
    node.data.kind === "initiate-approval" ||
      node.data.kind === "add-data" ||
    node.data.kind === "update-data" ||
    node.data.kind === "delete-data"
  ) {
    if (node.data.kind === "add-data") return getSchemaForNodeTarget(node, formSchemas);
    const config = normalizeActionConfig(node.data.config);
    return config.targetFormUuid
      ? formSchemas[config.targetFormUuid]
      : undefined;
  }

  return undefined;
}

export type NodeSummaryContext = {
  flowState?: FlowState;
  members?: MemberOption[];
  roles?: RoleOption[];
  fields?: FormFieldDescriptor[];
};

export function nodeSummary(data: WorkflowNodeData, context: NodeSummaryContext = {}) {
  if (data.kind === "initiate-approval") return "填写一条流程表单数据，待用户手动提交";
  if (data.kind === "trigger") {
    if (context.flowState?.flowType === "process") return "表单提交后启动审批流程";
    if (context.flowState?.triggerEvents.includes("button_click")) return "点击绑定按钮时，以当前记录启动自动化";
    if (context.flowState && !hasUpdateTriggerEvent(context.flowState.triggerEvents)) {
      return context.flowState.triggerEvents.length ? "所选表单事件发生时执行" : "未配置触发事件";
    }
    const config = normalizeTriggerConfig(data.config);
    if (config.changedFieldMode === "specific") {
      return config.changedFieldId
        ? `编辑时指定字段变更: ${context.fields?.find((field) => field.id === config.changedFieldId)?.label ?? config.changedFieldId}`
        : "未配置指定触发字段";
    }
    return "编辑时任意字段变更时执行";
  }
  if (data.kind === "approval" || data.kind === "executor") {
    const config = normalizeAssigneeConfig(data.config);
    const isApproval = data.kind === "approval";
    const targetLabel = isApproval ? "审批人" : "执行人";
    const ids = config.assigneeMode === "roles" ? config.roleIds ?? [] : config.assigneeIds ?? [];
    const targets = config.assigneeMode === "self" && isApproval
      ? "发起人本人"
      : summarizePeople(ids, config.assigneeMode === "roles", context);
    if (!targets) return `未配置${config.assigneeMode === "roles" ? (isApproval ? "审批角色" : "执行角色") : targetLabel}`;
    return isApproval
      ? `${targetLabel}: ${targets}\n${config.approvalMode === "any" ? "任一同意" : "全部同意"}`
      : `${targetLabel}: ${targets}\n${config.requiredFieldIds?.length ? `完成前需补填 ${config.requiredFieldIds.length} 个字段` : "完成任务后继续流转"}`;
  }
  if (data.kind === "copy") {
    const config = normalizeCopyConfig(data.config);
    const byRole = config.recipientMode === "roles";
    const targets = summarizePeople(byRole ? config.roleIds ?? [] : config.recipientIds ?? [], byRole, context);
    return targets ? `抄送${byRole ? "角色" : "成员"}: ${targets}\n通知后自动继续` : `未配置抄送${byRole ? "角色" : "成员"}`;
  }
  if (data.kind === "condition" || data.kind === "parallel-condition") {
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
  if (data.kind === "update-data" || data.kind === "delete-data") {
    const config = normalizeActionConfig(data.config);
    if (data.kind === "update-data" && config.updateMode === "data-node") {
      return config.sourceNodeId ? "更新查询数据源中的记录" : "未配置查询数据源节点";
    }
    return config.targetFormUuid || "未配置目标表单";
  }
  return "";
}

function summarizePeople(ids: string[], byRole: boolean, context: NodeSummaryContext) {
  return ids.map((id) => byRole
    ? context.roles?.find((role) => role.id === id)?.name ?? "未知角色"
    : context.members?.find((member) => member.id === id)?.displayName ?? "未知成员",
  ).join("、");
}

export function conditionBranchSummary(branch: ConditionBranch) {
  if (branch.entryMode === "otherwise") {
    return "前置条件均未命中时进入";
  }
  if (branch.mode === "all") {
    return "全部通过";
  }
  if (branch.mode === "rules") {
    return `${branch.rules.length} 条规则`;
  }
  return branch.expression || "未配置分支表达式";
}

export function getSourceModeLabel(mode: DataSourceMode) {
  if (mode === "data-node") return "从数据节点获取";
  if (mode === "trigger") return "使用触发记录";
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

export function fieldTypeMatches(
  sourceType: string,
  targetType: string | undefined,
) {
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
