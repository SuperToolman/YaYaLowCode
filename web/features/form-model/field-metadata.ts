export const BUILTIN_RECORD_FIELDS = [
  { id: "instanceId", label: "实例ID" },
  { id: "instanceTitle", label: "实例标题" },
  { id: "submitter", label: "创建人" },
  { id: "submitterOrganization", label: "创建人所属组织" },
  { id: "createdAt", label: "创建时间" },
  { id: "updatedAt", label: "修改时间" },
] as const;
export const WORKFLOW_BUILTIN_RECORD_FIELDS = [
  { id: "workflowApprovalStatus", label: "审批状态" },
  { id: "workflowInstanceStatus", label: "实例状态" },
  { id: "workflowCurrentApprovalNode", label: "当前审批节点" },
  { id: "workflowSubmitter", label: "提交人" },
] as const;
export const BUILTIN_RECORD_FIELD_LABELS = new Set(
  BUILTIN_RECORD_FIELDS.map((field) => field.label),
);

const fieldTypeLabels: Record<string, string> = {
  singleLineText: "单行文本",
  multiLineText: "多行文本",
  richText: "富文本",
  number: "数字",
  radio: "单选",
  checkbox: "多选",
  select: "下拉选择",
  multiSelect: "多选下拉",
  date: "日期",
  dateRange: "日期范围",
  member: "成员",
  department: "部门",
  countryCity: "国家地区",
  cascader: "级联选择",
  attachment: "附件",
  imageUpload: "图片",
  serialNumber: "流水号",
  subform: "子表单",
  associationFormField: "关联表单",
};
export const getViewFieldTypeLabel = (type: string) =>
  fieldTypeLabels[type] ?? type;
