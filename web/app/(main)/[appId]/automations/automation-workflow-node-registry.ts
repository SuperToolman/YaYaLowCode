import {
  createWorkflowNodeRegistry,
  groupWorkflowNodeDefinitions,
  type WorkflowNodeConfigValidationIssue,
} from "../../../components/workflow-editor/workflow-core";

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
  const sourceMode = readConfigString(config, "sourceMode") || "form";
  if (sourceMode === "data-node") {
    return requireConfigString("dataNodeId", "请选择来源数据节点")(config);
  }
  if (sourceMode === "related-form") {
    return requireConfigString("relatedFormPlaceholder", "请配置关联表单来源")(config);
  }
  return requireConfigString("formUuid", "请选择来源表单")(config);
}

function validateConditionConfig(config: unknown): WorkflowNodeConfigValidationIssue[] {
  const branches =
    typeof config === "object" && config !== null
      ? (config as Record<string, unknown>).branches
      : undefined;
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

export const automationWorkflowNodeRegistry = createWorkflowNodeRegistry([
  {
    kind: "trigger",
    label: "表单事件触发",
    description: "由表单记录事件启动",
    group: "触发节点",
    isRoot: true,
  },
  { kind: "add-data", label: "新增数据", description: "写入目标表单的新数据", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "update-data", label: "更新数据", description: "更新目标表单已有数据", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "get-one", label: "获取单条数据", description: "按条件查询一条记录", group: "数据节点", validateConfig: validateGetDataConfig },
  { kind: "get-many", label: "获取多条数据", description: "按条件查询多条记录", group: "数据节点", validateConfig: validateGetDataConfig },
  { kind: "delete-data", label: "删除数据", description: "按条件删除目标表单记录", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "http-request", label: "连接器", description: "调用外部接口或 Webhook", group: "连接器", validateConfig: validateHttpRequestConfig },
  { kind: "condition", label: "条件分支", description: "根据表达式判断后续流转", group: "分支节点", validateConfig: validateConditionConfig },
] as const);

export const automationWorkflowPaletteGroups = groupWorkflowNodeDefinitions(
  automationWorkflowNodeRegistry,
  { excludeKinds: ["trigger"] },
);

export const processWorkflowNodeRegistry = createWorkflowNodeRegistry([
  { kind: "trigger", label: "表单提交时", description: "由审批表单提交启动", group: "流程起点", isRoot: true },
  { kind: "add-data", label: "新增数据", description: "写入目标表单的新数据", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "update-data", label: "更新数据", description: "更新目标表单已有数据", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "get-one", label: "获取单条数据", description: "按条件查询一条记录", group: "数据节点", validateConfig: validateGetDataConfig },
  { kind: "get-many", label: "获取多条数据", description: "按条件查询多条记录", group: "数据节点", validateConfig: validateGetDataConfig },
  { kind: "delete-data", label: "删除数据", description: "按条件删除目标表单记录", group: "数据节点", validateConfig: requireConfigString("targetFormUuid", "请选择目标表单") },
  { kind: "http-request", label: "连接器", description: "调用外部接口或 Webhook", group: "连接器", validateConfig: validateHttpRequestConfig },
  { kind: "approval", label: "审批人", description: "等待指定审批人处理", group: "人工节点", validateConfig: (config) => { const values = config as { assigneeIds?: unknown[]; assignees?: unknown[] }; const assignees = values?.assigneeIds ?? values?.assignees; return Array.isArray(assignees) && assignees.length > 0 ? [] : [{ code: "missing-assignees", message: "请至少配置一位审批人", severity: "error" }]; } },
  { kind: "copy", label: "抄送人", description: "通知指定人员后自动继续", group: "人工节点" },
  { kind: "executor", label: "执行人", description: "等待指定执行人完成处理", group: "人工节点", validateConfig: (config) => { const values = config as { assigneeIds?: unknown[]; assignees?: unknown[] }; const assignees = values?.assigneeIds ?? values?.assignees; return Array.isArray(assignees) && assignees.length > 0 ? [] : [{ code: "missing-assignees", message: "请至少配置一位执行人", severity: "error" }]; } },
  { kind: "condition", label: "条件分支", description: "根据表单字段决定流转路径", group: "分支节点", validateConfig: validateConditionConfig },
] as const);

export const processWorkflowPaletteGroups = groupWorkflowNodeDefinitions(
  processWorkflowNodeRegistry,
  { excludeKinds: ["trigger"] },
);
