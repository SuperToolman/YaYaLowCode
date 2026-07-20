export type FormComponentAgentValueType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "date"
  | "dateRange"
  | "object"
  | "file";

export type FormComponentAgentCapability = {
  writable: boolean;
  valueType: FormComponentAgentValueType;
  description: string;
  requiresUserInteraction?: boolean;
  example?: unknown;
};

export const FORM_COMPONENT_AGENT_CAPABILITIES_VERSION = 1;

export const FORM_COMPONENT_AGENT_CAPABILITIES: Record<string, FormComponentAgentCapability> = {
  groupContainer: { writable: false, valueType: "object", description: "布局分组容器，不产生独立表单值。" },
  subform: { writable: false, valueType: "object", description: "子表单行数据数组，当前需要用户在表格中逐行确认。", requiresUserInteraction: true },
  singleLineText: { writable: true, valueType: "string", description: "简短的单行文本。", example: "示例文本" },
  description: { writable: false, valueType: "string", description: "只读说明内容，不产生用户填写值。" },
  multiLineText: { writable: true, valueType: "string", description: "可包含多行内容的长文本。", example: "第一行\n第二行" },
  number: { writable: true, valueType: "number", description: "数值字段，需要遵守最小值、最大值和步长约束。", example: 100 },
  radio: { writable: true, valueType: "string", description: "单选字段，值必须来自选项列表。", example: "选项一" },
  checkbox: { writable: true, valueType: "string[]", description: "多选字段，值必须是选项值数组。", example: ["选项一"] },
  select: { writable: true, valueType: "string", description: "单选下拉字段，值必须来自选项列表。", example: "选项一" },
  multiSelect: { writable: true, valueType: "string[]", description: "多选下拉字段，值必须是选项值数组。", example: ["选项一", "选项二"] },
  link: { writable: false, valueType: "string", description: "导航链接，不产生业务填写值。" },
  date: { writable: true, valueType: "date", description: "日期字段，使用 YYYY-MM-DD 格式。", example: "2026-07-15" },
  dateRange: { writable: true, valueType: "dateRange", description: "日期区间，使用两个 YYYY-MM-DD 字符串组成的数组。", example: ["2026-07-15", "2026-07-20"] },
  attachment: { writable: false, valueType: "file", description: "附件上传字段，需要用户选择本地文件。", requiresUserInteraction: true },
  imageUpload: { writable: false, valueType: "file", description: "图片上传字段，需要用户选择本地图片。", requiresUserInteraction: true },
  member: { writable: true, valueType: "string", description: "成员选择字段，值必须来自可用成员选项。", example: "zhangsan" },
  department: { writable: true, valueType: "string", description: "部门选择字段，值必须来自可用部门选项。", example: "engineering" },
  button: { writable: false, valueType: "boolean", description: "动作按钮，不产生可填写字段值。", requiresUserInteraction: true },
};

const UNKNOWN_COMPONENT_CAPABILITY: FormComponentAgentCapability = {
  writable: false,
  valueType: "object",
  description: "尚未登记 Agent 能力的组件，默认禁止自动填写。",
  requiresUserInteraction: true,
};

export function getFormComponentAgentCapability(type: string) {
  return FORM_COMPONENT_AGENT_CAPABILITIES[type] ?? UNKNOWN_COMPONENT_CAPABILITY;
}
