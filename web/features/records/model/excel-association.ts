import type { RuntimeSchemaField } from "@features/form-runtime/components";
import { getRecordsPage } from "@features/records/api";
import type { FormRecord } from "@features/records/types";

export const BUILTIN_RECORD_FIELDS = [
  { id: "instanceId", label: "实例ID" }, { id: "instanceTitle", label: "实例标题" },
  { id: "submitter", label: "提交人" }, { id: "submitterOrganization", label: "提交人组织" },
  { id: "createdAt", label: "创建时间" }, { id: "updatedAt", label: "修改时间" },
] as const;
export const WORKFLOW_BUILTIN_RECORD_FIELDS = [
  { id: "workflowApprovalStatus", label: "审批状态" }, { id: "workflowInstanceStatus", label: "实例状态" },
  { id: "workflowCurrentApprovalNode", label: "当前审批节点" }, { id: "workflowSubmitter", label: "提交人" },
] as const;
export const BUILTIN_RECORD_FIELD_LABELS = new Set(BUILTIN_RECORD_FIELDS.map((field) => field.label));

const fieldTypeLabels: Record<string, string> = {
  singleLineText: "单行文本", multiLineText: "多行文本", richText: "富文本", number: "数字", radio: "单选",
  checkbox: "多选", select: "下拉选择", multiSelect: "多选下拉", date: "日期", dateRange: "日期范围",
  member: "成员", department: "部门", countryCity: "国家地区", cascader: "级联选择", attachment: "附件",
  imageUpload: "图片", serialNumber: "流水号", subform: "子表单", associationFormField: "关联表单",
};
export const getViewFieldTypeLabel = (type: string) => fieldTypeLabels[type] ?? type;

export function buildExcelColumns(fields: RuntimeSchemaField[]) {
  const labelCounts = new Map<string, number>();
  for (const field of fields) labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  return fields.map((field) => ({ field, header: (labelCounts.get(field.label) ?? 0) > 1 ? `${field.label} (${field.id})` : field.label }));
}

export type AssociationImportLookup = { primaryFieldId: string; records: FormRecord[] };
export function resolveAssociationImportValue(cell: unknown, lookup?: AssociationImportLookup) {
  const text = String(cell ?? "").trim();
  if (!text || !lookup) return text;
  const bracketMatch = text.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const displayValue = (bracketMatch?.[1] ?? text).trim();
  const fallbackId = bracketMatch?.[2]?.trim() ?? text;
  const matched = lookup.records.find((record) => String(record.data[lookup.primaryFieldId] ?? "").trim().toLocaleLowerCase() === displayValue.toLocaleLowerCase());
  return matched?.id ?? lookup.records.find((record) => record.id === fallbackId)?.id ?? fallbackId;
}
export function formatAssociationExportValue(value: unknown, lookup?: AssociationImportLookup) {
  const recordId = String(value ?? "").trim();
  if (!recordId || !lookup) return value ?? "";
  const record = lookup.records.find((item) => item.id === recordId);
  const displayValue = String(record?.data[lookup.primaryFieldId] ?? "").trim();
  return record ? (displayValue ? `${displayValue}[${recordId}]` : recordId) : recordId;
}
export async function loadAssociationImportLookup(field: RuntimeSchemaField): Promise<AssociationImportLookup | null> {
  const associationFormId = field.props?.associationFormId;
  const primaryFieldId = field.props?.associationPrimaryFieldId;
  if (!associationFormId || !primaryFieldId) return null;
  const records: FormRecord[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await getRecordsPage({ formUuid: associationFormId, page, pageSize: 100, filters: [], sorts: [], detail: true });
    records.push(...result.items); total = result.total; page += 1;
  } while (records.length < total);
  return { primaryFieldId, records };
}
