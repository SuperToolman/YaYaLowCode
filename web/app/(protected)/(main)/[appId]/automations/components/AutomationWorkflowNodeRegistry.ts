import {
  createWorkflowNodeRegistry,
  groupWorkflowNodeDefinitions,
  type WorkflowNodeConfigValidationIssue,
} from "@components/workflow-editor/workflow-core";
import {
  CirclePlay, CodeFork, Database, Databases, GearBranches, PencilToSquare,
  Person, PersonPencil, PersonWorker, PlugConnection, SquarePlus, TrashBin,
} from "@gravity-ui/icons";
import { normalizeGetDataConfig, validateGetFilterRules, type WorkflowNodeKind, type NodeMenuItem, type PaletteNodeKind } from "../[automationId]/automation-editor-model";

export const workflowNodeIcons = {
  trigger: CirclePlay,
  "initiate-approval": PersonPencil,
  "add-data": SquarePlus,
  "update-data": PencilToSquare,
  "get-one": Database,
  "get-many": Databases,
  "delete-data": TrashBin,
  "http-request": PlugConnection,
  condition: CodeFork,
  "parallel-condition": GearBranches,
  approval: Person,
  copy: PersonPencil,
  executor: PersonWorker,
} satisfies Record<WorkflowNodeKind, typeof CirclePlay>;

function readConfigString(config: unknown, key: string) {
  if (typeof config !== "object" || config === null) return "";
  const values = config as Record<string, unknown>;
  return typeof values[key] === "string" ? values[key].trim() : "";
}

function requireConfigString(
  key: string,
  message: string,
): (config: unknown) => WorkflowNodeConfigValidationIssue[] {
  return (config) =>
    readConfigString(config, key)
      ? []
      : [{ code: `missing-${key}`, message, severity: "error" }];
}

function validateGetDataConfig(config: unknown): WorkflowNodeConfigValidationIssue[] {
  try {
    const normalized = normalizeGetDataConfig(config);
    const issues = normalized.sourceMode === "data-node"
      ? requireConfigString("dataNodeId", "请选择来源数据节点")(config)
      : normalized.sourceMode === "trigger" ? []
      : requireConfigString("formUuid", "请选择来源表单")(config);
    const error = normalized.filterMode === "rules" ? validateGetFilterRules(normalized.rules ?? []) : undefined;
    if (error) issues.push({ code: "invalid-get-rules", message: error, severity: "error" });
    return issues;
  } catch (error) { return [{ code: "invalid-get-config", message: String(error), severity: "error" }]; }
}

function validateUpdateDataConfig(config: unknown): WorkflowNodeConfigValidationIssue[] {
  const updateMode = readConfigString(config, "updateMode") || "form";
  if (updateMode === "data-node") {
    return requireConfigString("sourceNodeId", "请选择查询数据源节点")(config);
  }
  return requireConfigString("targetFormUuid", "请选择目标表单")(config);
}

function validateConditionConfig(config: unknown): WorkflowNodeConfigValidationIssue[] {
  const branches =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>).branches
      : undefined;
  if (Array.isArray(branches) && branches.filter((branch) => typeof branch === "object" && branch !== null && branch.entryMode === "otherwise").length > 1) {
    return [{ code: "duplicate-otherwise", message: "条件分支只能配置一个否则进入项", severity: "error" }];
  }
  return Array.isArray(branches) && branches.length > 0
    ? []
    : [{ code: "missing-branches", message: "请至少配置一个条件分支", severity: "error" }];
}

function validateHttpRequestConfig(config: unknown): WorkflowNodeConfigValidationIssue[] {
  const url = readConfigString(config, "url");
  if (!url) {
    return [{ code: "missing-url", message: "请填写请求地址", severity: "error" }];
  }
  try {
    new URL(url);
    return [];
  } catch {
    return [{ code: "invalid-url", message: "请求地址必须是有效的绝对 URL", severity: "error" }];
  }
}

type FlowType = "trigger" | "process";
const bothFlowTypes: readonly FlowType[] = ["trigger", "process"];
const processOnly: readonly FlowType[] = ["process"];

export const workflowNodeDefinitions = createWorkflowNodeRegistry([
  { kind: "trigger", icon: workflowNodeIcons.trigger, label: "表单事件触发", description: "由表单记录事件启动", group: "触发节点", isRoot: true, flowTypes: bothFlowTypes, configKind: "trigger" },
  { kind: "initiate-approval", icon: workflowNodeIcons["initiate-approval"], label: "发起审批", description: "填写流程表单数据，待用户手动提交", group: "数据节点", validateConfig: (config) => { const c = config as { targetFormUuid?: string; initiatorMode?: string; initiatorId?: string; initiatorFieldId?: string }; return c?.targetFormUuid && (c.initiatorMode === "field" ? c.initiatorFieldId : c.initiatorId) ? [] : [{ code: "missing-approval-config", message: "请选择流程表单和发起人", severity: "error" }]; } },
  { kind: "add-data", icon: workflowNodeIcons["add-data"], label: "新增数据", description: "写入目标表单的新数据", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "update-data", icon: workflowNodeIcons["update-data"], label: "更新数据", description: "更新目标表单已有数据", group: "数据节点", validateConfig: validateUpdateDataConfig },
  { kind: "get-one", icon: workflowNodeIcons["get-one"], label: "获取单条数据", description: "按条件查询一条记录", group: "数据节点", validateConfig: validateGetDataConfig },
  { kind: "get-many", icon: workflowNodeIcons["get-many"], label: "获取多条数据", description: "按条件查询多条记录", group: "数据节点", validateConfig: validateGetDataConfig },
  { kind: "delete-data", icon: workflowNodeIcons["delete-data"], label: "删除数据", description: "按条件删除目标表单记录", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "http-request", icon: workflowNodeIcons["http-request"], label: "连接器", description: "调用外部接口或 Webhook", group: "连接器", validateConfig: validateHttpRequestConfig },
  { kind: "condition", icon: workflowNodeIcons["condition"], label: "条件分支", description: "根据表达式判断后续流转", group: "分支节点", validateConfig: validateConditionConfig },
  { kind: "parallel-condition", icon: workflowNodeIcons["parallel-condition"], label: "并行条件分支", description: "并行执行所有满足条件的分支", group: "分支节点", validateConfig: validateConditionConfig },
  { kind: "approval", icon: workflowNodeIcons["approval"], label: "审批人", description: "等待指定审批人处理", group: "人工节点", validateConfig: (config) => { const values = config as { assigneeIds?: unknown[]; assigneeMode?: string; roleIds?: unknown[] }; const assignees = values?.assigneeMode === "self" ? ["self"] : values?.assigneeMode === "roles" ? values.roleIds : values?.assigneeIds; return Array.isArray(assignees) && assignees.length > 0 ? [] : [{ code: "missing-assignees", message: "请至少配置一位审批人", severity: "error" }]; } },
  { kind: "copy", icon: workflowNodeIcons["copy"], label: "抄送人", description: "通知指定人员后自动继续", group: "人工节点" },
  { kind: "executor", icon: workflowNodeIcons["executor"], label: "执行人", description: "等待指定执行人完成处理", group: "人工节点", validateConfig: (config) => { const values = config as { assigneeIds?: unknown[]; assigneeMode?: string; roleIds?: unknown[] }; const assignees = values?.assigneeMode === "roles" ? values.roleIds : values?.assigneeIds; return Array.isArray(assignees) && assignees.length > 0 ? [] : [{ code: "missing-assignees", message: "请至少配置一位执行人", severity: "error" }]; } },
] as const).map((definition) => ({
  ...definition,
  flowTypes: ["approval", "copy", "executor"].includes(definition.kind) ? processOnly : bothFlowTypes,
  configKind: ["condition", "parallel-condition"].includes(definition.kind) ? "condition" : ["trigger", "approval", "executor", "copy"].includes(definition.kind) ? "flow" : "data",
}));

function registryFor(flowType: FlowType) {
  return workflowNodeDefinitions
    .filter((definition) => definition.flowTypes.includes(flowType))
    .map((definition) => definition.kind === "trigger" && flowType === "process"
      ? { ...definition, label: "表单提交时", description: "由审批表单提交启动", group: "流程起点" }
      : definition);
}

export const automationWorkflowNodeRegistry = registryFor("trigger");
export const processWorkflowNodeRegistry = registryFor("process");
export const automationWorkflowPaletteGroups = groupWorkflowNodeDefinitions(automationWorkflowNodeRegistry, { excludeKinds: ["trigger"] });
export const processWorkflowPaletteGroups = groupWorkflowNodeDefinitions(processWorkflowNodeRegistry, { excludeKinds: ["trigger"] });

export function workflowConfigKind(kind: WorkflowNodeKind) {
  return workflowNodeDefinitions.find((definition) => definition.kind === kind)?.configKind;
}

export const triggerDataNodeMenu: Array<{
  group: string;
  items: NodeMenuItem[];
}> = automationWorkflowPaletteGroups.map((group) => ({
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

export const processDataNodeMenu: Array<{
  group: string;
  items: NodeMenuItem[];
}> = processWorkflowPaletteGroups.map((group) => ({
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
