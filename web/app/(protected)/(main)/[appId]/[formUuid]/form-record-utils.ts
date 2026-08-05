import type { RuntimeSchemaField } from "../../../../components/runtime-form-renderer";
import type { ViewConfig } from "./use-form-views";
import { formatCountryCityValue, isCountryCityValue } from "../../../../lib/location-catalog";
import { getFormComponentAgentCapability } from "../../../../lib/form-component-agent-capabilities";
import type { FormRecord } from "@/features/records/types";

type SchemaField = RuntimeSchemaField;
type AssociationFormData = { records: Map<string, FormRecord> };
type FormDraft = { id: string; savedAt: string; values: Record<string, unknown> };

export function getVisibleDataFields(fields: SchemaField[]) {
  return fields.filter(
    (field) =>
      !field.props?.isHidden &&
      field.type !== "description" &&
      field.type !== "groupContainer" &&
      field.type !== "button" &&
      field.type !== "link",
  );
}

export function getDetailParentRecordLabel(
  record: FormRecord | undefined,
  primaryFieldId?: string,
  secondaryFieldId?: string,
  fallbackRecordId = "",
) {
  const primary = getDetailParentRecordValue(record, primaryFieldId);
  const secondary = getDetailParentRecordValue(record, secondaryFieldId);
  return [primary || `主记录 ${record?.id ?? fallbackRecordId}`, secondary].filter(Boolean).join(" · ");
}

export function getDetailParentRecordValue(record: FormRecord | undefined, fieldId?: string) {
  if (!record || !fieldId) return "";
  switch (fieldId) {
    case "instanceId": return record.id;
    case "instanceTitle": return `${record.createdBy}发起的记录`;
    case "submitter":
    case "workflowSubmitter": return record.createdBy;
    case "submitterOrganization": return record.submitterOrganization ?? "";
    case "createdAt": return record.createdAt;
    case "updatedAt": return record.updatedAt;
    default: return formatRecordValue(findRecordFieldValue(record.data, fieldId));
  }
}

export function findRecordFieldValue(value: unknown, fieldId: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecordFieldValue(item, fieldId);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (fieldId in record) return record[fieldId];
  for (const child of Object.values(record)) {
    const found = findRecordFieldValue(child, fieldId);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function getAssociationRecordId(field: SchemaField, value: unknown) {
  if (field.type !== "associationFormField" || typeof value !== "string" || !value) {
    return null;
  }
  return value;
}

export function getAssociationPrimaryValue(field: SchemaField, record: FormRecord) {
  const primaryFieldId = field.props?.associationPrimaryFieldId;
  return primaryFieldId
    ? formatRecordValue(record.data[primaryFieldId])
    : record.id;
}

export function getTableFieldDisplayValue(
  field: SchemaField,
  record: FormRecord,
  associationForms: Map<string, AssociationFormData>,
) {
  const relatedRecordId = getAssociationRecordId(field, record.data[field.id]);
  const associationFormId = field.props?.associationFormId;
  const relatedRecord = relatedRecordId && associationFormId
    ? associationForms.get(associationFormId)?.records.get(relatedRecordId)
    : undefined;

  return relatedRecord
    ? getAssociationPrimaryValue(field, relatedRecord)
    : formatRecordValue(record.data[field.id]);
}

export function formatRecordValue(value: unknown) {
  if (isCountryCityValue(value)) {
    return formatCountryCityValue(value);
  }

  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      return `共 ${value.length} 行`;
    }
    return value.join("、") || "-";
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value) || "-";
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return "-";
}

export function serializeExcelValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

export function deserializeExcelValue(field: SchemaField, cell: unknown) {
  if (cell === null || cell === undefined || String(cell).trim() === "") return undefined;
  const capability = getFormComponentAgentCapability(field.type);
  const text = String(cell).trim();

  if (capability.valueType === "number") {
    const value = Number(cell);
    return Number.isFinite(value) ? value : undefined;
  }
  if (capability.valueType === "boolean") {
    return ["true", "是", "1", "yes"].includes(text.toLowerCase());
  }
  if (capability.valueType === "string[]" || capability.valueType === "dateRange") {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return text.split(/[、,，;；|]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  if (capability.valueType === "object" || capability.valueType === "file") {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "表单";
}

export function getFormDraftStorageKey(formUuid: string) {
  return `yaya-low-code:form-drafts:${formUuid}`;
}

export function readFormDrafts(formUuid: string): FormDraft[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getFormDraftStorageKey(formUuid)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((draft): draft is FormDraft => Boolean(
      draft
      && typeof draft === "object"
      && "id" in draft
      && "savedAt" in draft
      && "values" in draft,
    ));
  } catch {
    return [];
  }
}

export function writeFormDrafts(formUuid: string, drafts: FormDraft[]) {
  window.localStorage.setItem(getFormDraftStorageKey(formUuid), JSON.stringify(drafts));
}

export function getViewFieldValue(record: FormRecord, fieldId: string, formName: string) {
  if (fieldId in record.data) return formatRecordValue(record.data[fieldId]);
  return getBuiltinRecordValues(record, formName)[fieldId] ?? "";
}

export function applyViewConfig(records: FormRecord[], config: ViewConfig, formName: string) {
  const filtered = records.filter((record) => config.filters.every((rule) => {
    const actual = getViewFieldValue(record, rule.fieldId, formName).toLowerCase();
    const expected = rule.value.trim().toLowerCase();
    if (!expected) return true;
    if (rule.operator === "equals") return actual === expected;
    if (rule.operator === "notEquals") return actual !== expected;
    if (rule.operator === "greaterThan") return actual > expected;
    if (rule.operator === "lessThan") return actual < expected;
    return actual.includes(expected);
  }));
  if (!config.sorts.length) return filtered;
  return [...filtered].sort((left, right) => {
    for (const rule of config.sorts) {
      const comparison = getViewFieldValue(left, rule.fieldId, formName).localeCompare(getViewFieldValue(right, rule.fieldId, formName), undefined, { numeric: true, sensitivity: "base" });
      if (comparison !== 0) return rule.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

export function getBuiltinRecordValues(
  record: FormRecord,
  formName: string,
  isWorkflow = false,
): Record<string, string> {
  const values = {
    instanceId: record.id,
    instanceTitle: `${record.createdBy}发起的${formName}`,
    submitter: record.createdBy,
    submitterOrganization: record.submitterOrganization ?? "",
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
  if (!isWorkflow) return values;
  return {
    ...values,
    workflowApprovalStatus: workflowApprovalStatusLabel(record.data.workflowApprovalStatus),
    workflowInstanceStatus: workflowInstanceStatusLabel(record.data.workflowInstanceStatus),
    workflowCurrentApprovalNode: formatRecordValue(record.data.workflowCurrentApprovalNode),
    workflowSubmitter: formatRecordValue(record.data.workflowSubmitter) || record.createdBy,
  };
}

export function workflowApprovalStatusLabel(value: unknown) {
  return ({ saved: "保存", reviewing: "审核中", approved: "审核通过", rejected: "拒绝" } as Record<string, string>)[String(value)] ?? "保存";
}

export function workflowInstanceStatusLabel(value: unknown) {
  return ({ in_progress: "进行中", running: "进行中", paused: "已暂停", completed: "已完成", failed: "失败" } as Record<string, string>)[String(value)] ?? "进行中";
}

export function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function estimateTableColumnWidth(
  values: string[],
  minWidth = 0,
  maxWidth = 320,
) {
  const widestTextWidth = values.reduce(
    (widest, value) => Math.max(widest, estimateTableTextWidth(value)),
    0,
  );

  return Math.min(maxWidth, Math.max(minWidth, Math.ceil(widestTextWidth + 24)));
}

export function estimateTableTextWidth(value: string) {
  const units = Array.from(value).reduce(
    (total, character) => total + (/^[\u0000-\u00ff]$/.test(character) ? 0.62 : 1),
    0,
  );
  return units * 12;
}
