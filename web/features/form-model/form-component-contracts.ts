import type { RuntimeFieldProps, RuntimeFieldType, RuntimeSchemaField } from "@/features/form-model/runtime-types";

export type JsonSchema = Record<string, unknown>;
export type AgentCapability = "create" | "configure" | "writeValue" | "readValue";
export type PatchOperation = { op: "add" | "replace" | "remove"; path: string; value?: unknown };

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
  suggestion?: string;
};

export type Constraint = {
  id: string;
  description: string;
  paths?: string[];
};

export type Recipe = {
  id: string;
  intent: string;
  description: string;
  patch: PatchOperation[];
  expected?: unknown;
};

export type AgentContract = {
  purpose: string;
  goodFor: string[];
  badFor: string[];
  capabilities: AgentCapability[];
  valueSchema?: JsonSchema;
  constraints: Constraint[];
  recipes: Recipe[];
  limitations: string[];
};

export type PropertyDefinition = {
  property: string;
  label: string;
  editor: string;
  valueType: string;
  required?: boolean;
  defaultValue?: unknown;
  visibleWhen?: { property: string; equals?: unknown; exists?: boolean };
  options?: Array<{ label: string; value: string }>;
};

export type ComponentManifest = {
  type: RuntimeFieldType | string;
  version: number;
  label: string;
  category: string;
  runtimeSchema: JsonSchema;
  designerSchema: PropertyDefinition[];
  agent: AgentContract;
  normalize(input: unknown): unknown;
  validate(input: unknown): ValidationIssue[];
};

const issue = (path: string, code: string, message: string, suggestion?: string): ValidationIssue => ({ path, code, message, suggestion });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function normalizeObject(input: unknown) {
  return isRecord(input) ? { ...input } : {};
}

function validateProps(input: unknown, required: string[] = []): ValidationIssue[] {
  if (!isRecord(input)) return [issue("/props", "type", "组件属性必须是对象")];
  return required.filter((key) => input[key] === undefined || input[key] === null).map((key) => issue(`/props/${key}`, "required", `缺少必填属性 ${key}`));
}

function validateOptions(input: unknown): ValidationIssue[] {
  if (!isRecord(input) || input.options === undefined) return [];
  if (!Array.isArray(input.options)) return [issue("/props/options", "type", "options 必须是数组")];
  const seen = new Set<string>();
  return input.options.flatMap((option, index) => {
    if (!isRecord(option) || typeof option.label !== "string" || typeof option.value !== "string") return [issue(`/props/options/${index}`, "item", "选项必须包含字符串 label 和 value")];
    if (seen.has(option.value)) return [issue(`/props/options/${index}/value`, "duplicate", "选项 value 不能重复")];
    seen.add(option.value);
    return [];
  });
}

function component(type: RuntimeFieldType | string, label: string, category: string, agent: AgentContract, designerSchema: PropertyDefinition[], validate: (input: unknown) => ValidationIssue[] = () => []) : ComponentManifest {
  return {
    type,
    label,
    category,
    version: 1,
    runtimeSchema: { type: "object", properties: { type: { const: type }, props: { type: "object" } } },
    designerSchema,
    agent,
    normalize: normalizeObject,
    validate: (input) => {
      const props = isRecord(input) && isRecord(input.props) ? input.props : input;
      return [...validateProps(input), ...validate(props)];
    },
  };
}

const configurable: AgentContract = {
  purpose: "可配置的表单字段",
  goodFor: [],
  badFor: [],
  capabilities: ["create", "configure", "writeValue", "readValue"],
  constraints: [],
  recipes: [],
  limitations: [],
};

export const COMPONENT_MANIFESTS: Record<string, ComponentManifest> = {
  separator: component("separator", "分割线", "布局", {
    ...configurable,
    purpose: "使用 HeroUI Separator 分隔表单内容，不产生表单值",
    capabilities: ["create", "configure"],
    goodFor: ["内容分隔", "布局"],
    badFor: ["用户输入", "子表单列"],
    constraints: [{ id: "layout-only", description: "仅用于主画布或分组，不能作为子表单列或数据字段" }],
  }, [
    { property: "orientation", label: "方向", editor: "select", valueType: "string", defaultValue: "horizontal", options: [{ value: "horizontal", label: "横向" }, { value: "vertical", label: "纵向" }] },
    { property: "separatorStyle", label: "风格", editor: "select", valueType: "string", defaultValue: "solid", options: [{ value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }, { value: "dotted", label: "点线" }] },
    { property: "separatorVariant", label: "变体", editor: "select", valueType: "string", defaultValue: "default", options: [{ value: "default", label: "默认" }, { value: "secondary", label: "次级" }, { value: "tertiary", label: "三级" }] },
  ], (input) => {
    if (!isRecord(input)) return [];
    return [
      ["orientation", ["horizontal", "vertical"]],
      ["separatorStyle", ["solid", "dashed", "dotted"]],
      ["separatorVariant", ["default", "secondary", "tertiary"]],
    ].flatMap(([key, options]) => typeof key === "string" && input[key] !== undefined && !options.includes(input[key] as string)
      ? [issue(`/props/${key}`, "enum", `无效的分割线属性 ${key}`)] : []);
  }),
  associationFormField: component("associationFormField", "关联数据", "高级字段", {
    ...configurable,
    purpose: "从其他表单选择记录并按映射回填字段",
    goodFor: ["跨表查询", "关联记录", "字段回填"],
    badFor: ["自由文本输入"],
    constraints: [{ id: "source", description: "必须指定目标表单和主字段" }],
    limitations: ["目标表单删除后需要重新配置"],
    recipes: [{ id: "association-basic", intent: "创建一个关联数据字段", description: "选择目标表单记录并回填字段", patch: [{ op: "replace", path: "/props/associationFormId", value: "<form-id>" }, { op: "replace", path: "/props/associationPrimaryFieldId", value: "<field-id>" }] }],
  }, [
    { property: "associationFormId", label: "关联表单", editor: "form-ref", valueType: "string", required: true },
    { property: "associationPrimaryFieldId", label: "主字段", editor: "field-ref", valueType: "string", required: true },
    { property: "associationFills", label: "回填映射", editor: "field-mapping-list", valueType: "array" },
  ], (input) => {
    const props = isRecord(input) && isRecord(input.props) ? input.props : input;
    return validateProps(props, ["associationFormId", "associationPrimaryFieldId"]);
  }),
  subform: component("subform", "子表单", "高级字段", {
    ...configurable,
    purpose: "在主表单内维护多行明细数据",
    goodFor: ["订单明细", "费用明细", "批量项目"],
    badFor: ["单值字段"],
    capabilities: ["create", "configure", "readValue"],
    constraints: [{ id: "layout", description: "table 布局必须设置列字段" }],
    recipes: [{ id: "subform-table", intent: "创建桌面端明细表", description: "使用表格布局并显示操作列", patch: [{ op: "replace", path: "/props/subformArrangement", value: "table" }, { op: "replace", path: "/props/subformDisplayMode", value: "desktop" }, { op: "replace", path: "/props/subformShowHeader", value: true }, { op: "replace", path: "/props/subformShowActionColumn", value: true }], expected: { rows: "array" } }],
    limitations: ["行数据需要用户逐行确认"],
  }, [
    { property: "subformArrangement", label: "排列方式", editor: "select", valueType: "string", options: [{ label: "表格", value: "table" }, { label: "卡片", value: "tile" }] },
    { property: "subformShowActionColumn", label: "显示操作列", editor: "switch", valueType: "boolean" },
    { property: "subformPageSize", label: "分页大小", editor: "number", valueType: "number" },
  ]),
  cascader: component("cascader", "级联选择", "高级字段", {
    ...configurable,
    purpose: "按层级路径选择一个最终节点",
    goodFor: ["组织层级", "区域选择", "分类目录"],
    badFor: ["平级多选"],
    constraints: [{ id: "data-source", description: "必须提供层级数据源" }],
    recipes: [{ id: "cascader-basic", intent: "创建分类级联选择", description: "使用层级数据源选择分类", patch: [{ op: "replace", path: "/props/dataSource", value: [{ value: "category", label: "分类", children: [{ value: "item", label: "项目" }] }] }] }],
    limitations: ["存储值是用 . 拼接的路径字符串"],
  }, [{ property: "dataSource", label: "数据源", editor: "tree-data", valueType: "object", required: true }]),
  member: component("member", "成员选择", "组织字段", {
    ...configurable,
    purpose: "从组织成员目录选择成员",
    goodFor: ["负责人", "审批人", "执行人"],
    badFor: ["外部联系人"],
    constraints: [{ id: "scope", description: "成员范围必须属于当前组织目录" }],
    recipes: [{ id: "member-owner", intent: "创建负责人字段", description: "允许选择一个组织成员", patch: [{ op: "replace", path: "/props/memberMultiple", value: false }, { op: "replace", path: "/props/memberSelectableScope", value: "all" }] }],
    limitations: ["成员 ID 必须来自组织目录"],
  }, [{ property: "memberMultiple", label: "允许多选", editor: "switch", valueType: "boolean" }, { property: "memberSelectableScope", label: "可选范围", editor: "select", valueType: "string" }]),
  department: component("department", "部门选择", "组织字段", {
    ...configurable,
    purpose: "从组织架构选择部门",
    goodFor: ["归属部门", "数据权限范围"],
    badFor: ["个人成员"],
    constraints: [{ id: "scope", description: "部门必须来自当前组织架构" }],
    recipes: [{ id: "department-owner", intent: "创建归属部门字段", description: "选择一个组织部门", patch: [{ op: "replace", path: "/props/memberMultiple", value: false }] }],
    limitations: ["部门 ID 必须来自组织架构"],
  }, [{ property: "memberMultiple", label: "允许多选", editor: "switch", valueType: "boolean" }]),
  serialNumber: component("serialNumber", "流水号", "高级字段", {
    purpose: "生成可配置规则的只读流水号",
    goodFor: ["订单号", "工单号", "业务编号"],
    badFor: ["用户手工输入编号"],
    capabilities: ["create", "configure", "readValue"],
    constraints: [{ id: "rules", description: "至少配置一个流水号规则" }],
    recipes: [{ id: "serial-year-count", intent: "创建按年度重置的订单号", description: "使用年份和自增序号", patch: [{ op: "replace", path: "/props/serialNumberRules", value: [{ id: "year", type: "submittedDate", format: "year" }, { id: "count", type: "autoCount", digits: 5, fixedDigits: true, resetPeriod: "yearly", initialValue: 1 }] }] }],
    limitations: ["生成后不可由 Agent 直接填写"],
  }, [{ property: "serialNumberRules", label: "流水号规则", editor: "serial-rule-list", valueType: "array", required: true }]),
  select: component("select", "下拉选择", "基础字段", { ...configurable, purpose: "从有限选项中选择一个值", goodFor: ["状态", "分类", "级别"], badFor: ["长文本"], constraints: [{ id: "options", description: "至少需要一个选项" }], recipes: [{ id: "select-status", intent: "创建状态下拉字段", description: "提供启用和停用选项", patch: [{ op: "replace", path: "/props/options", value: [{ label: "启用", value: "active" }, { label: "停用", value: "inactive" }] }] }], limitations: [] }, [{ property: "options", label: "选项", editor: "option-list", valueType: "array", required: true }], validateOptions),
  radio: component("radio", "单选", "基础字段", { ...configurable, purpose: "从有限选项中选择一个值", goodFor: ["互斥选项"], badFor: ["多选"], constraints: [{ id: "options", description: "至少需要一个选项" }], recipes: [], limitations: [] }, [{ property: "options", label: "选项", editor: "option-list", valueType: "array", required: true }], validateOptions),
  multiSelect: component("multiSelect", "多选下拉", "基础字段", { ...configurable, purpose: "从有限选项中选择多个值", goodFor: ["标签", "技能"], badFor: ["互斥状态"], constraints: [{ id: "options", description: "至少需要一个选项" }], recipes: [], limitations: [] }, [{ property: "options", label: "选项", editor: "option-list", valueType: "array", required: true }], validateOptions),
};

export const FORM_COMPONENT_CONTRACT_VERSION = 1;

export function getComponentManifest(type: string) { return COMPONENT_MANIFESTS[type]; }
export function getComponentCatalog() { return Object.values(COMPONENT_MANIFESTS).map(({ type, version, label, category, agent }) => ({ type, version, label, category, purpose: agent.purpose, capabilities: agent.capabilities })); }

export function validateComponentField(field: Partial<RuntimeSchemaField> & { type?: string; props?: RuntimeFieldProps }): ValidationIssue[] {
  if (!field.type) return [issue("/type", "required", "组件类型不能为空")];
  const manifest = getComponentManifest(field.type);
  if (!manifest) return [issue("/type", "unsupported", `未登记组件类型 ${field.type}`, "先读取组件目录并选择受支持的组件")];
  return manifest.validate({ ...field, props: field.props ?? {} });
}
