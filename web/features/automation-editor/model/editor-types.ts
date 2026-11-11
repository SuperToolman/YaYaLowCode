import type { AutomationStatus, TriggerEvent } from "./management-types";
import { type WorkflowGraphEdge, type WorkflowGraphNode, type WorkflowNodeData as WorkflowNodeDataBase } from "@/features/workflow/editor/workflow-core";
import { type BranchRule, type BranchRuleOperator } from "@/features/conditions";
import { type FieldMappingRow } from "@/features/automation-editor/field-mapping";

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
  props?: FormFieldDescriptor["props"];
};

export type FormFieldDescriptor = {
  id: string;
  label: string;
  type: string;
  parentGroupId?: string;
  isRequired: boolean;
  options: FieldOption[];
  props?: import("@/features/form-model/runtime-types").RuntimeFieldProps;
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

export type LegacyBranchRule = {
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

export type LegacyBranchRuleOperator =
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

export type LegacyFieldMappingRow = {
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
  deleteMode?: "data-node" | "form";
  filterMode?: "all" | "rules";
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
  compensationRequest?: {
    method?: string;
    url?: string;
    headersText?: string;
    bodyTemplate?: string;
  };
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

export type NodeSummaryContext = {
  flowState?: FlowState;
  members?: MemberOption[];
  roles?: RoleOption[];
  fields?: FormFieldDescriptor[];
};
