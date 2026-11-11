import type { RuntimeSchemaField, RuntimeFieldProps, RuntimeDataSource } from "@/features/form-model/runtime-types";
import type { RichTextDocument } from "@/shared/ui/RichTextEditor";
import type { RuntimeRendererState } from "../components/runtime-form-store";
import { getMemberInitialValue } from "../components/member-default-value";
import { calculateFormulaValues } from "./form-formula";
import { normalizeCountryCityValue } from "@/shared/lib/location-catalog";
export function getInitialValues(
  fields: RuntimeSchemaField[],
  initialValues?: Record<string, unknown>,
  userId?: string,
  enableMemberDefaults = true,
) {
  const values: Record<string, unknown> = {};
  const subformIds = new Set(
    fields.filter((field) => field.type === "subform").map((field) => field.id),
  );

  for (const field of fields) {
    if (field.parentGroupId && subformIds.has(field.parentGroupId)) {
      continue;
    }
    if (
      field.type === "description" ||
      field.type === "separator" ||
      field.type === "link" ||
      field.type === "groupContainer" ||
      field.type === "html" ||
      field.type === "tsx"
    ) {
      continue;
    }

    if (field.type === "subform") {
      values[field.id] = Array.isArray(initialValues?.[field.id])
        ? initialValues?.[field.id]
        : [];
      continue;
    }

    if (field.type === "button") {
      values[field.id] =
        initialValues?.[field.id] ?? field.props?.defaultValue ?? "";
      continue;
    }

    if (field.type === "richText") {
      values[field.id] = isRichTextDocument(initialValues?.[field.id])
        ? initialValues![field.id]
        : EMPTY_RICH_TEXT_DOCUMENT;
      continue;
    }

    values[field.id] = field.type === "member"
      ? getMemberInitialValue(field.props ?? {}, { userId, initialValue: initialValues?.[field.id], enabled: enableMemberDefaults })
      : initialValues?.[field.id] ?? getFieldDefaultValue(field);
  }

  return values;
}

export function getInitialDataSources(dataSources?: RuntimeDataSource[]) {
  const result: Record<string, unknown> = {};

  for (const source of dataSources ?? []) {
    result[source.name] = parseDataSourceValue(source);
  }

  return result;
}

function parseDataSourceValue(source: RuntimeDataSource) {
  if (source.kind === "number") {
    const next = Number(source.initialValue);
    return Number.isFinite(next) ? next : 0;
  }

  if (source.kind === "boolean") {
    return source.initialValue === "true";
  }

  if (source.kind === "object") {
    try {
      return source.initialValue ? JSON.parse(source.initialValue) : {};
    } catch {
      return {};
    }
  }

  return source.initialValue;
}

export function getFieldDefaultValue(field: RuntimeSchemaField, userId?: string) {
  if (field.type === "member") return getMemberInitialValue(field.props ?? {}, { userId });
  if (field.type === "associationFormField") return "";
  if (field.type === "serialNumber") {
    return formatRuntimeSerialNumber(field.props ?? {});
  }
  if (field.props?.defaultValueType === "none") {
    if (
      field.type === "checkbox" ||
      field.type === "multiSelect" ||
      field.type === "dateRange"
    ) {
      return [];
    }
    if (field.type === "countryCity") {
      return normalizeCountryCityValue(undefined);
    }
    return "";
  }

  const defaultValue = field.props?.defaultValue;

  if (field.type === "countryCity") {
    return normalizeCountryCityValue(defaultValue);
  }

  if (
    field.type === "checkbox" ||
    field.type === "multiSelect" ||
    field.type === "dateRange"
  ) {
    return Array.isArray(defaultValue) ? defaultValue : [];
  }

  if (field.type === "number") {
    return (
      toOptionalNumber(
        defaultValue as string | number | string[] | undefined,
      ) ?? ""
    );
  }

  return defaultValue ?? "";
}

export const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = { type: "doc", content: [] };

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content),
  );
}

export function formatRuntimeSerialNumber(props: RuntimeFieldProps) {
  if (props.serialNumberRules?.length) {
    return props.serialNumberRules
      .map((rule) => {
        if (rule.type === "fixedText") return rule.value;
        if (rule.type === "formField") return rule.fallback || "{字段}";
        if (rule.type === "submittedDate")
          return formatRuntimeSerialDate(new Date(), rule.format);
        return rule.fixedDigits
          ? String(rule.initialValue).padStart(rule.digits, "0")
          : String(rule.initialValue);
      })
      .join("");
  }
  const initialValue = Math.max(
    1,
    Math.trunc(props.serialNumberInitialValue ?? 1),
  );
  if (!props.serialNumberFixedDigits) return String(initialValue);
  return String(initialValue).padStart(
    Math.max(1, props.serialNumberDigits ?? 4),
    "0",
  );
}

function formatRuntimeSerialDate(
  date: Date,
  format:
    | "year"
    | "yearMonth"
    | "yearMonthDay"
    | "yearMonthDayHourMinute"
    | "yearMonthDayHourMinuteSecond",
) {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  if (format === "year") return String(date.getFullYear());
  if (format === "yearMonth") return day.slice(0, 6);
  if (format === "yearMonthDay") return day;
  const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  return format === "yearMonthDayHourMinute"
    ? `${day}${time}`
    : `${day}${time}${String(date.getSeconds()).padStart(2, "0")}`;
}

export function buildInitialRuntimeState(
  fields: RuntimeSchemaField[],
  dataSourceDefinitions: RuntimeDataSource[] | undefined,
  initialValues?: Record<string, unknown>,
  userId?: string,
  enableMemberDefaults = true,
): RuntimeRendererState {
  const initialFieldValues = getInitialValues(fields, initialValues, userId, enableMemberDefaults);
  const calculated = calculateFormulaValues(fields, initialFieldValues);
  const values = calculated.values;
  const dataSources = getInitialDataSources(dataSourceDefinitions);
  return {
    values,
    dataSources,
    formulaErrors: calculated.errors,
    debugEvent: undefined,
  };
}

export function toOptionalNumber(value: string | number | string[] | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  return undefined;
}
