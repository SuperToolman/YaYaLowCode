import type { RuntimeSchemaField } from "./runtime-form-types";
import { getDateValidation, getDateValidationError } from "./date-validation";

export function getSubformValidationKey(parentId: string, row: number, fieldId: string) {
  return `${parentId}:${row}:${fieldId}`;
}

function hasRichTextContent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as { text?: string; type?: string; content?: unknown[] };
  return Boolean(node.text?.trim()) || node.type === "image" ||
    Boolean(node.content?.some(hasRichTextContent));
}

export function validateRuntimeFields(
  fields: RuntimeSchemaField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const children = new Map<string, RuntimeSchemaField[]>();
  for (const field of fields) {
    if (field.parentGroupId) {
      children.set(field.parentGroupId, [...(children.get(field.parentGroupId) ?? []), field]);
    }
  }
  function validate(field: RuntimeSchemaField, value: unknown, key: string) {
    const props = field.props ?? {};
    if (props.isHidden || props.isDisabled || props.isReadOnly) return;
    if (["description", "link", "button", "html", "tsx"].includes(field.type)) return;
    if (field.type === "groupContainer") {
      for (const child of children.get(field.id) ?? []) validate(child, values[child.id], child.id);
      return;
    }
    const empty = field.type === "richText" ? !hasRichTextContent(value) :
      field.type === "countryCity" ? !value || typeof value !== "object" || !(value as { code?: string }).code :
      Array.isArray(value) ? value.length === 0 || value.every((item) => item == null || item === "") :
      value == null || (typeof value === "string" && !value.trim());
    const incompleteRange = field.type === "dateRange" &&
      (!Array.isArray(value) || value.length !== 2 || value.some((item) => !item));
    if (props.isRequired && (empty || incompleteRange)) errors[key] = `请填写${field.label}`;
    if (["date", "dateRange"].includes(field.type) && !empty && !incompleteRange) {
      const dates = field.type === "dateRange" ? value as unknown[] : [value];
      const dateError = getDateValidationError(getDateValidation(props), dates);
      if (dateError) errors[key] = dateError;
    }
    if (field.type === "singleLineText" && props.formatValidation && !empty) {
      const format = runtimeFormatRules[props.formatValidation];
      if (!format || typeof value !== "string" || !format.pattern.test(value)) {
        errors[key] = format?.message ?? "格式校验配置无效";
      }
    }
    if (field.type === "number" && !empty) {
      const number = Number(value);
      if (!Number.isFinite(number)) errors[key] = "请输入有效数字";
      else if (props.minValue != null && number < props.minValue) errors[key] = `不能小于 ${props.minValue}`;
      else if (props.maxValue != null && number > props.maxValue) errors[key] = `不能大于 ${props.maxValue}`;
    }
    if (field.type === "subform" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (!row || typeof row !== "object") return;
        for (const child of children.get(field.id) ?? []) {
          validate(child, row[child.id], getSubformValidationKey(field.id, index, child.id));
        }
      });
    }
  }
  for (const field of fields.filter((item) => !item.parentGroupId)) validate(field, values[field.id], field.id);
  return errors;
}

export const runtimeFormatRules = {
  email: { pattern: /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/, message: "请输入有效的邮箱地址" },
  phoneCN: { pattern: /^(?:\+86)?1[3-9][0-9]{9}$/, message: "请输入有效的中国大陆手机号，可带 +86 前缀" },
  idCardCN: { pattern: /^[1-9][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]$/, message: "请输入有效的18位身份证号码" },
};
