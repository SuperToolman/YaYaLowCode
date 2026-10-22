import { COLUMN_COUNT } from "./designer-constants";
import { buildSchema, normalizeDesignerFields, normalizePageDesignerProps } from "./designer-schema";
import { validateDesignerSchema } from "./designer-validation";
import type { PlacedField } from "./designer-types";
import { isDesignerComponentType } from "./components/CompTool";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate before source edits can enter the visual designer or save API. */
export function parseDesignerSource(source: string, formUuid: string) {
  const value: unknown = JSON.parse(source);
  if (!isObject(value) || !Array.isArray(value.fields) || typeof value.formName !== "string") {
    throw new Error("Schema 需要包含 formName 字符串和 fields 数组");
  }
  if (value.formUuid !== formUuid) throw new Error("不能修改当前表单的 formUuid");
  if (value.pageProps != null && !isObject(value.pageProps)) throw new Error("pageProps 必须为对象");
  const ids = new Set<string>();
  for (const field of value.fields) {
    if (!isObject(field) || typeof field.id !== "string" || !field.id ||
        typeof field.type !== "string" || typeof field.label !== "string" || !isObject(field.props)) {
      throw new Error("每个字段需要有效的 id、type、label 和 props");
    }
    if (ids.has(field.id)) throw new Error(`字段 ID 重复：${field.id}`);
    if (!isDesignerComponentType(field.type)) throw new Error(`未知组件类型：${field.type}`);
    ids.add(field.id);
    for (const key of ["row", "column", "rowSpan", "colSpan"] as const) {
      if (!Number.isInteger(field[key]) || (field[key] as number) < (key.endsWith("Span") ? 1 : 0)) {
        throw new Error(`字段 ${field.id} 的 ${key} 无效`);
      }
    }
    if ((field.column as number) + (field.colSpan as number) > COLUMN_COUNT) {
      throw new Error(`字段 ${field.id} 超出 ${COLUMN_COUNT} 列，请调整或删除该字段`);
    }
    if (field.parentGroupId != null && typeof field.parentGroupId !== "string") {
      throw new Error(`字段 ${field.id} 的父容器 ID 无效`);
    }
  }
  const fields = value.fields as PlacedField[];
  const byId = new Map(fields.map((field) => [field.id, field]));
  for (const field of fields) {
    const visited = new Set([field.id]);
    let parentId = field.parentGroupId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`字段 ${field.id} 存在循环容器引用`);
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || !["groupContainer", "subform"].includes(parent.type)) {
        throw new Error(`字段 ${field.id} 引用了不存在的容器，请同时清理其子字段`);
      }
      parentId = parent.parentGroupId;
    }
  }
  const issues = validateDesignerSchema(fields);
  if (issues.length) throw new Error(issues[0].message);
  const pageProps = normalizePageDesignerProps(value.pageProps);
  for (const [key, item] of Object.entries(pageProps)) {
    if (["formulaValidations", "serviceValidations", "customServiceValidations", "businessFailureRules", "integrationAutomations", "serviceExecutions", "customServiceExecutions", "beforeSubmitActions", "afterSubmitActions", "afterDataInitActions", "dataSources", "assets", "indexedFieldIds"].includes(key) && !Array.isArray(item)) {
      throw new Error(`pageProps.${key} 必须为数组`);
    }
  }
  return buildSchema(formUuid, value.formName, normalizeDesignerFields(fields), pageProps);
}
