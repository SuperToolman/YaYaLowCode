import type { SourceFieldChoice } from "@/features/conditions";
import type { BranchRule } from "@/features/conditions";
import { BUILTIN_RECORD_FIELDS, WORKFLOW_BUILTIN_RECORD_FIELDS } from "@/features/form-model/field-metadata";
export const DEFAULT_DISABLED_REASON = "当前数据不满足按钮可用条件";
export type ButtonParameter = { id: string; name: string; type: "constant" | "field"; value?: string; fieldId?: string };
export const RESERVED_PAGE_PARAMETERS = new Set(["appId", "formUuid", "buttonPageMode", "record", "task", "viewUuid"]);
export type ButtonDraft = {
  name: string; icon?: string | null; description: string; actionType: "fill_form" | "open_page" | "run_automation";
  actionConfig: { parameters?: ButtonParameter[]; automationId?: string; targetAppId: string; targetFormUuid: string; fieldIds: string[]; associationRules?: BranchRule[]; linkType?: "internal" | "external"; pageMode?: "edit" | "view"; url?: string; openMode?: "window" | "sidebar" };
  availability: { mode: "all" | "conditions"; rules: BranchRule[] };
  disabledReason: string;
};
export type ButtonDefinition = ButtonDraft & { id: string; appId: string; formUuid: string; targetFormName?: string | null; updatedAt: string; createdAt: string };
export type SchemaField = { id: string; type: string; label?: string; parentGroupId?: string | null; props?: { isReadOnly?: boolean; isDisabled?: boolean; isHidden?: boolean; options?: { label: string; value: string }[] } };
export const WRITABLE_TYPES = new Set(["singleLineText", "multiLineText", "richText", "number", "radio", "checkbox", "select", "multiSelect", "date", "dateRange", "attachment", "imageUpload", "member", "department", "countryCity", "cascader", "associationFormField", "subform"]);
const systemKeys = new Set<string>([...BUILTIN_RECORD_FIELDS, ...WORKFLOW_BUILTIN_RECORD_FIELDS].map((field) => field.id));
export function writableFields(fields: SchemaField[]) { return fields.filter((f) => WRITABLE_TYPES.has(f.type) && !systemKeys.has(f.id) && !f.props?.isReadOnly && !f.props?.isDisabled && !f.props?.isHidden); }
export function conditionFields(fields: SchemaField[], workflow: boolean): SourceFieldChoice[] {
  return [
    ...fields.filter((f) => (WRITABLE_TYPES.has(f.type) || f.type === "serialNumber") && !systemKeys.has(f.id)).map((f) => ({ key: f.id, label: f.label || f.id, fieldType: f.type, options: f.props?.options ?? [] })),
    ...(workflow ? [...BUILTIN_RECORD_FIELDS, ...WORKFLOW_BUILTIN_RECORD_FIELDS] : BUILTIN_RECORD_FIELDS).map((f) => ({ key: f.id, label: f.label, fieldType: f.id === "createdAt" || f.id === "updatedAt" ? "date" : "singleLineText", options: [], isSystem: true })),
  ];
}
export function emptyDraft(): ButtonDraft { return { name: "", icon: null, description: "", actionType: "fill_form", actionConfig: { targetAppId: "", targetFormUuid: "", fieldIds: [] }, availability: { mode: "all", rules: [] }, disabledReason: "" }; }
export function draftFromDefinition(button: ButtonDefinition): ButtonDraft {
  return structuredClone({ name: button.name, icon: button.icon, description: button.description, actionType: button.actionType, actionConfig: button.actionConfig, availability: button.availability, disabledReason: button.disabledReason });
}
export function changeTarget(draft: ButtonDraft, appId: string, formUuid: string): ButtonDraft { return { ...draft, actionConfig: { ...draft.actionConfig, targetAppId: appId, targetFormUuid: formUuid, fieldIds: [], associationRules: [] } }; }
export function validatePageParameters(parameters: ButtonParameter[], fields: SchemaField[], workflow: boolean): string {
  const names = new Set<string>(), ids = new Set<string>();
  const allowed = new Set(conditionFields(fields, workflow).map(field => field.key));
  for (const parameter of parameters) {
    const name = parameter.name.trim();
    if (!parameter.id || ids.has(parameter.id)) return "参数行标识无效或重复";
    ids.add(parameter.id);
    if (!name || [...name].length > 20) return "参数名称必填且最多20字";
    if (names.has(name)) return "参数名称不能重复";
    if (RESERVED_PAGE_PARAMETERS.has(name)) return "参数名称不能使用平台保留名称";
    names.add(name);
    if (parameter.type === "field" && !allowed.has(parameter.fieldId ?? "")) return "请选择有效的当前记录字段";
    if (parameter.type !== "field" && parameter.type !== "constant") return "参数类型无效";
  }
  return "";
}
export function validateDraft(draft: ButtonDraft, fields: SchemaField[], _workflow: boolean, ownerFormUuid?: string): string {
  void _workflow;
  if (!draft.name.trim() || draft.name.trim().length > 100) return "请输入按钮名称（最多100字）";
  if (draft.actionType === "run_automation") return draft.actionConfig.automationId ? "" : "请选择集成自动化";
  if (draft.actionType === "open_page") {
    if (!["window", "sidebar"].includes(draft.actionConfig.openMode ?? "")) return "请选择打开方式";
    if (draft.actionConfig.linkType === "internal") {
      if (!draft.actionConfig.targetAppId || !draft.actionConfig.targetFormUuid) return "请选择表单";
      if (!["edit", "view"].includes(draft.actionConfig.pageMode ?? "")) return "请选择编辑或查看";
    } else if (draft.actionConfig.linkType === "external") {
      try { const url = new URL(draft.actionConfig.url ?? ""); if (!["http:", "https:"].includes(url.protocol)) return "链接地址必须使用 http 或 https"; } catch { return "请输入有效的链接地址"; }
    } else return "请选择链接类型";
    return "";
  }
  if (!draft.actionConfig.targetFormUuid || !draft.actionConfig.targetAppId) return "请选择填写对象";
  if (ownerFormUuid && draft.actionConfig.targetFormUuid !== ownerFormUuid) {
    return draft.actionConfig.associationRules?.length ? "" : "需重新配置：请补充关联实例条件";
  }
  const writable = new Set(writableFields(fields).map((f) => f.id));
  if (!draft.actionConfig.fieldIds.length) return "请至少选择一个填写字段";
  if (draft.actionConfig.fieldIds.some((id) => !writable.has(id))) return "存在失效或不可填写的字段，请重新选择";
  return "";
}
export function buttonPageUrl(button: ButtonDefinition, sourceFormUuid: string, recordId: string, recordValues: Record<string, unknown> = {}): string {
  const config = button.actionConfig;
  const external = config.linkType === "external";
  const url = new URL(external ? config.url ?? "" : `/${encodeURIComponent(config.targetAppId)}/${encodeURIComponent(config.targetFormUuid)}`, "http://button.local");
  if (!external) {
    url.searchParams.set("buttonPageMode", config.pageMode ?? "view");
    if (config.targetFormUuid === sourceFormUuid) url.searchParams.set("record", recordId);
  }
  for (const parameter of config.parameters ?? []) {
    const name = parameter.name.trim();
    if (!name || RESERVED_PAGE_PARAMETERS.has(name)) continue;
    const value = parameter.type === "constant" ? parameter.value ?? "" : recordValues[parameter.fieldId ?? ""];
    url.searchParams.set(name, value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return external ? url.href : `${url.pathname}${url.search}${url.hash}`;
}
export function buttonPageParams(url: string, appId: string, formUuid: string): Record<string, string> {
  return { ...Object.fromEntries(new URL(url, "http://button.local").searchParams), appId, formUuid };
}
