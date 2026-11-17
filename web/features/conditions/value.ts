import type { BranchRuleOperator, SourceFieldChoice } from "./index";

// Versioned envelopes keep legacy string-valued callbacks and saved rules readable.
export const CONDITION_PATH_PREFIX = "__condition_path_v2__:";
export const CONDITION_VALUE_PREFIX = "__condition_value_v2__:";
export type ConditionPath = { root: string; path: string[] };
export type ConditionValue = string | number | boolean | null | ConditionValue[];

export function readConditionPath(key: string): ConditionPath {
  if (!key.startsWith(CONDITION_PATH_PREFIX)) return { root: key, path: [] };
  try {
    const ref = JSON.parse(key.slice(CONDITION_PATH_PREFIX.length)) as ConditionPath;
    if (typeof ref.root === "string" && Array.isArray(ref.path) && ref.path.length <= 8 && ref.path.every(item => typeof item === "string" && item)) return ref;
  } catch { /* Invalid references remain invalid, never become direct fields. */ }
  return { root: "", path: [] };
}
export function writeConditionPath(ref: ConditionPath): string {
  return ref.path.length ? CONDITION_PATH_PREFIX + JSON.stringify(ref) : ref.root;
}
export function conditionRoot(key: string): string { return readConditionPath(key).root; }
export function encodeConditionValue(value: ConditionValue): string { return CONDITION_VALUE_PREFIX + JSON.stringify(value); }
export function decodeConditionValue(raw = ""): ConditionValue {
  if (!raw.startsWith(CONDITION_VALUE_PREFIX)) return raw;
  try {
    const value: unknown = JSON.parse(raw.slice(CONDITION_VALUE_PREFIX.length));
    const scalar = (item: unknown) => item === null || ["string", "number", "boolean"].includes(typeof item);
    return (scalar(value) || Array.isArray(value) && value.length <= 500 && value.every(scalar)) ? value as ConditionValue : null;
  } catch { return null; }
}
export const numericTypes = new Set(["number", "integer", "rating", "slider", "progress"]);
export const dateTypes = new Set(["date", "dateTime", "datetime", "time"]);
export function isMultipleField(field?: SourceFieldChoice): boolean {
  return !!field && (["checkbox", "multiSelect"].includes(field.fieldType) || ["member", "department"].includes(field.fieldType) && !!(field.props?.memberMultiple || field.props?.multiple));
}
export function operatorIds(field?: SourceFieldChoice): BranchRuleOperator[] {
  if (!field) return ["eq", "neq", "inAny", "notInAny", "hasValue", "noValue"];
  const empty: BranchRuleOperator[] = ["hasValue", "noValue"];
  if (numericTypes.has(field.fieldType) || dateTypes.has(field.fieldType)) return ["eq", "neq", "gt", "gte", "lt", "lte", "between", ...empty];
  if (isMultipleField(field)) return ["containsAny", "containsAll", "containsNone", ...empty];
  if (["attachment", "imageUpload", "richText", "countryCity", "dateRange"].includes(field.fieldType)) return empty;
  if (["boolean", "switch"].includes(field.fieldType)) return ["eq", "neq", ...empty];
  if (["select", "radio", "member", "department", "associationFormField"].includes(field.fieldType)) return ["eq", "neq", "inAny", "notInAny", ...empty];
  return ["eq", "neq", "contains", "notContains", "inAny", "notInAny", ...empty];
}
export function compatibleFields(left?: SourceFieldChoice, right?: SourceFieldChoice): boolean {
  if (!left || !right) return false;
  if (left.fieldType === "associationFormField" || right.fieldType === "associationFormField") return left.fieldType === right.fieldType && !!left.props?.associationFormId && left.props.associationFormId === right.props?.associationFormId;
  if (isMultipleField(left) !== isMultipleField(right)) return false;
  if (numericTypes.has(left.fieldType) || numericTypes.has(right.fieldType)) return numericTypes.has(left.fieldType) && numericTypes.has(right.fieldType);
  if (dateTypes.has(left.fieldType) || dateTypes.has(right.fieldType)) return left.fieldType === right.fieldType;
  return left.fieldType === right.fieldType || ["singleLineText", "multiLineText"].includes(left.fieldType) && ["singleLineText", "multiLineText"].includes(right.fieldType);
}
