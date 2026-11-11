import type { RuntimeFieldProps } from "@/features/form-model/runtime-types";

const STRUCTURED_VALUE_PREFIX = "__yaya_json_value_v1__:";

export function decodeMappedFieldValue(
  fieldType: string,
  value: string,
  props?: RuntimeFieldProps,
): unknown {
  if (value.startsWith(STRUCTURED_VALUE_PREFIX)) {
    return parseJson(value.slice(STRUCTURED_VALUE_PREFIX.length), undefined);
  }

  if (isArrayField(fieldType, props)) {
    return parseJson(value, []);
  }

  if (fieldType === "countryCity") {
    return value ? parseJson(value, undefined) : undefined;
  }

  return value;
}

export function encodeMappedFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const serialized = JSON.stringify(value);
    return serialized ? `${STRUCTURED_VALUE_PREFIX}${serialized}` : "";
  }
  return String(value);
}

function isArrayField(fieldType: string, props?: RuntimeFieldProps) {
  return fieldType === "multiSelect" || fieldType === "checkbox" ||
    fieldType === "dateRange" || (fieldType === "member" && props?.memberMultiple);
}

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
