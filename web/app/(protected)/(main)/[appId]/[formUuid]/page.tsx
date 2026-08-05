"use client";

import { use, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Checkbox,
  Dropdown,
  Input,
  ListBox,
  ProgressBar,
  SearchField,
  Select,
  toast,
} from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Card } from "@heroui/react/card";
import { Modal } from "@heroui/react/modal";
import { Drawer } from "@heroui/react/drawer";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ArrowDownToLine,
  ArrowChevronDown,
  ArrowUpArrowDown,
  ArrowUpFromLine,
  Ellipsis,
  Funnel,
  Pencil,
  Pin,
  PinSlash,
  Plus,
  Sliders,
  TrashBin,
} from "@gravity-ui/icons";
import {
  RuntimeFormRenderer,
  RuntimeFormSurface,
  type RuntimeFormSchema,
  type RuntimeSchemaField,
} from "@/features/form-runtime/components";
import { getSystemPageBySlug, isSystemPageSlug } from "../../../../lib/system-pages";
import { FormAgentPanel } from "./form-agent-panel";
import { RecordsTable, RuntimeFormPanel } from "./records-table";
import { SystemPageView } from "./system-page-view";
import { buildExcelWorkbook, downloadExcelBuffer, parseExcelFile } from "./xlsx-worker-client";
import { deserializeExcelValue, formatDateTime, getBuiltinRecordValues, getDetailParentRecordLabel, getVisibleDataFields, readFormDrafts, sanitizeFileName, serializeExcelValue, writeFormDrafts } from "./form-record-utils";
import {
  getForm,
  getFormSchema,
} from "@/features/form-runtime/api";
import { useDetailFormsQuery, useFormBootstrapQuery, useParentRecordsQuery, useRecordsQuery } from "@/features/records/queries";
import { runWorkflowRecordAction, useRecordMutations } from "@/features/records/mutations";
import { getRecordsPage } from "@/features/records/api";
import type { FormRecord } from "@/features/records/types";
import { useAuth } from "../../../../components/auth-provider";
import { notifyAppNavigationChanged } from "../components/app-navigation-events";
import {
  useFormViews,
  type FormView,
  type ViewConfig,
  type ViewFilterOperator,
} from "./use-form-views";

type SchemaField = RuntimeSchemaField;
type FormSchema = RuntimeFormSchema;

function normalizeDetailFormSchema(schema: FormSchema, isDetailForm: boolean): FormSchema {
  if (!isDetailForm) return schema;

  const fields = [...schema.fields]
    .sort((left, right) => left.row - right.row || left.column - right.column || left.id.localeCompare(right.id))
    .map((field, row) => ({
      ...field,
      parentGroupId: null,
      row,
      column: 0,
      rowSpan: 1,
      colSpan: 1,
    }));

  return {
    ...schema,
    columns: 1,
    rows: Math.max(fields.length, 1),
    fields,
  };
}

type DetailDisplayFieldOption = { id: string; label: string };
type ViewFieldOption = { id: string; label: string; type: string; typeLabel: string };

function getFieldTypeTagClass(type: string) {
  if (["singleLineText", "multiLineText", "richText", "description", "html", "tsx"].includes(type)) return "field-type-tag--text";
  if (["number", "serialNumber", "formula"].includes(type)) return "field-type-tag--number";
  if (["radio", "checkbox", "select", "multiSelect", "cascader", "countryCity"].includes(type)) return "field-type-tag--choice";
  if (["date", "dateRange"].includes(type)) return "field-type-tag--date";
  if (["member", "department"].includes(type)) return "field-type-tag--person";
  if (["subform", "associationFormField"].includes(type)) return "field-type-tag--relation";
  if (["attachment", "imageUpload"].includes(type)) return "field-type-tag--media";
  return "field-type-tag--builtin";
}

function ReorderableViewFieldRow({
  field,
  config,
  onConfigChange,
}: {
  field: ViewFieldOption;
  config: ViewConfig;
  onConfigChange: (next: ViewConfig) => void;
}) {
  const id = `view-field-${field.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  }, [setDragRef, setDropRef]);
  const allFieldIds = config.columnOrder ?? [];
  const sortableFieldIds = config.sortableFieldIds ?? allFieldIds;
  const frozenFieldIds = config.frozenFieldIds ?? [];
  const configuredWidth = config.columnWidths?.[field.id];
  const isFrozen = frozenFieldIds.includes(field.id);
  const isVisible = config.visibleFieldIds.includes(field.id);

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={[
        "view-column-config-grid__row items-center border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-bg-subtle)]",
        isDragging ? "relative z-10 bg-[var(--color-bg-panel)] opacity-60 shadow-[var(--shadow-floating)]" : "",
        isOver && !isDragging ? "border-t-2 border-t-[var(--color-primary)]" : "",
      ].join(" ")}
    >
      <div className="min-w-0 pr-3">
        <span className="block truncate text-sm text-[var(--color-text-primary)]">{field.label}</span>
        <span className="mt-0.5 block truncate font-mono text-xs text-[var(--color-text-secondary)]">{field.id}</span>
      </div>
      <span className={`field-type-tag ${getFieldTypeTagClass(field.type)}`}>{field.typeLabel}</span>
      <Checkbox aria-label={`显示列：${field.label}`} isSelected={config.visibleFieldIds.includes(field.id)} onChange={(selected) => onConfigChange({
        ...config,
        visibleFieldIds: selected ? [...new Set([...config.visibleFieldIds, field.id])] : config.visibleFieldIds.filter((id) => id !== field.id),
        sortableFieldIds: selected ? sortableFieldIds : sortableFieldIds.filter((id) => id !== field.id),
        frozenFieldIds: selected ? frozenFieldIds : frozenFieldIds.filter((id) => id !== field.id),
      })} className="justify-center"><Checkbox.Content className="justify-center"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>
      <Checkbox aria-label={`显示排序按钮：${field.label}`} isSelected={config.visibleFieldIds.includes(field.id) && sortableFieldIds.includes(field.id)} isDisabled={!config.visibleFieldIds.includes(field.id)} onChange={(selected) => onConfigChange({
        ...config,
        sortableFieldIds: selected ? [...new Set([...sortableFieldIds, field.id])] : sortableFieldIds.filter((id) => id !== field.id),
      })} className="justify-center"><Checkbox.Content className="justify-center"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>
      <Input aria-label={`${field.label}列宽`} type="number" inputMode="numeric" min={24} max={480} value={configuredWidth === undefined ? "" : String(configuredWidth)} placeholder="动态" onChange={(event) => {
        const raw = event.target.value.trim();
        const columnWidths = { ...(config.columnWidths ?? {}) };
        if (!raw) {
          delete columnWidths[field.id];
        } else {
          const width = Number(raw);
          if (!Number.isFinite(width)) return;
          columnWidths[field.id] = Math.round(width);
        }
        onConfigChange({ ...config, columnWidths });
      }} className="w-[72px]" />
      <div className="flex items-center justify-center gap-1">
        <Button isIconOnly variant="ghost" aria-label={`${isFrozen ? "取消冻结" : "冻结"}${field.label}列`} isDisabled={!isVisible} className={isFrozen ? "h-7 w-7 text-[var(--color-primary)]" : "h-7 w-7 text-[var(--color-text-secondary)]"} onPress={() => onConfigChange({ ...config, frozenFieldIds: isFrozen ? frozenFieldIds.filter((id) => id !== field.id) : [...frozenFieldIds, field.id] })}>{isFrozen ? <PinSlash className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>
        <Button isIconOnly variant="ghost" aria-label={`拖拽调整${field.label}列顺序`} className="h-7 w-7 cursor-grab text-[var(--color-text-secondary)] active:cursor-grabbing" {...attributes} {...listeners}><ArrowUpArrowDown className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function DetailDisplayFieldSelect({ ariaLabel, options, selectedKey, onSelectionChange }: { ariaLabel: string; options: DetailDisplayFieldOption[]; selectedKey: string; onSelectionChange: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery)) : options;
  }, [options, query]);
  return <Select aria-label={ariaLabel} selectedKey={selectedKey} onSelectionChange={(key) => onSelectionChange(String(key ?? selectedKey))}>
    <Select.Trigger><Select.Value>{options.find((field) => field.id === selectedKey)?.label ?? selectedKey}</Select.Value></Select.Trigger>
    <Select.Popover className="w-64">
      <div className="border-b border-[var(--color-border)] p-2"><SearchField aria-label={`搜索${ariaLabel}`} value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="搜索字段" /><SearchField.ClearButton aria-label="清除搜索" /></SearchField.Group></SearchField></div>
      <ListBox className="max-h-56 overflow-y-auto" aria-label={ariaLabel}>{filteredOptions.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}{filteredOptions.length === 0 ? <ListBox.Item id="empty" isDisabled>没有匹配字段</ListBox.Item> : null}</ListBox>
    </Select.Popover>
  </Select>;
}

type ViewKey = "records" | "submit";
type ImportWorkbookState = {
  fileName: string;
  headers: string[];
  rows: unknown[][];
  mappings: Record<number, string>;
  progress: number;
  successCount: number;
  failureCount: number;
  importing: boolean;
  completed: boolean;
};

type FormDraft = {
  id: string;
  savedAt: string;
  values: Record<string, unknown>;
};

const EMPTY_IMPORT_STATE: ImportWorkbookState = {
  fileName: "",
  headers: [],
  rows: [],
  mappings: {},
  progress: 0,
  successCount: 0,
  failureCount: 0,
  importing: false,
  completed: false,
};

const BUILTIN_RECORD_FIELDS = [
  { id: "instanceId", label: "实例ID" },
  { id: "instanceTitle", label: "实例标题" },
  { id: "submitter", label: "提交人" },
  { id: "submitterOrganization", label: "提交人组织" },
  { id: "createdAt", label: "创建时间" },
  { id: "updatedAt", label: "修改时间" },
] as const;

const WORKFLOW_BUILTIN_RECORD_FIELDS = [
  { id: "workflowApprovalStatus", label: "审批状态" },
  { id: "workflowInstanceStatus", label: "实例状态" },
  { id: "workflowCurrentApprovalNode", label: "当前审批节点" },
  { id: "workflowSubmitter", label: "提交人" },
] as const;

const VIEW_FIELD_TYPE_LABELS: Record<string, string> = {
  singleLineText: "单行文本",
  multiLineText: "多行文本",
  richText: "富文本",
  number: "数字",
  radio: "单选",
  checkbox: "多选",
  select: "下拉选择",
  multiSelect: "多选下拉",
  date: "日期",
  dateRange: "日期范围",
  member: "成员",
  department: "部门",
  countryCity: "国家地区",
  cascader: "级联选择",
  attachment: "附件",
  imageUpload: "图片",
  serialNumber: "流水号",
  subform: "子表单",
  associationFormField: "关联表单",
};

const BUILTIN_RECORD_FIELD_LABELS = new Set<string>(
  BUILTIN_RECORD_FIELDS.map((field) => field.label),
);

function getViewFieldTypeLabel(type: string) {
  return VIEW_FIELD_TYPE_LABELS[type] ?? type;
}

const buildExcelColumns = (fields: SchemaField[]) => {
  const labelCounts = new Map<string, number>();
  for (const field of fields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  }
  return fields.map((field) => ({
    field,
    header: (labelCounts.get(field.label) ?? 0) > 1
      ? `${field.label} (${field.id})`
      : field.label,
  }));
};

type AssociationImportLookup = {
  primaryFieldId: string;
  records: FormRecord[];
};

function resolveAssociationImportValue(cell: unknown, lookup?: AssociationImportLookup) {
  const text = String(cell ?? "").trim();
  if (!text || !lookup) return text;

  const bracketMatch = text.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  const displayValue = (bracketMatch?.[1] ?? text).trim();
  const fallbackId = bracketMatch?.[2]?.trim() ?? text;
  const normalizedDisplayValue = displayValue.toLocaleLowerCase();
  const matchedByDisplay = lookup.records.find((record) =>
    String(record.data[lookup.primaryFieldId] ?? "").trim().toLocaleLowerCase() === normalizedDisplayValue,
  );
  if (matchedByDisplay) return matchedByDisplay.id;
  const matchedById = lookup.records.find((record) => record.id === fallbackId);
  return matchedById?.id ?? fallbackId;
}

function formatAssociationExportValue(value: unknown, lookup?: AssociationImportLookup) {
  const recordId = String(value ?? "").trim();
  if (!recordId || !lookup) return value ?? "";
  const record = lookup.records.find((item) => item.id === recordId);
  if (!record) return recordId;
  const displayValue = String(record.data[lookup.primaryFieldId] ?? "").trim();
  return displayValue ? `${displayValue}[${recordId}]` : recordId;
}

async function loadAssociationImportLookup(field: SchemaField): Promise<AssociationImportLookup | null> {
  const associationFormId = field.props?.associationFormId;
  const primaryFieldId = field.props?.associationPrimaryFieldId;
  if (!associationFormId || !primaryFieldId) return null;

  const records: FormRecord[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await getRecordsPage({ formUuid: associationFormId, page, pageSize: 100, filters: [], sorts: [], detail: true });
    records.push(...result.items);
    total = result.total;
    page += 1;
  } while (records.length < total);

  return { primaryFieldId, records };
}

export default function FormHome({
  params,
}: {
  params: Promise<{ appId: string; formUuid: string }>;
}) {
  const route = use(params);
  const [resolvedFormType, setResolvedFormType] = useState<"normal" | "workflow" | "defined" | "detail" | null>(
    () => isSystemPageSlug(route.formUuid) ? "normal" : null,
  );

  useEffect(() => {
    if (isSystemPageSlug(route.formUuid)) {
      return;
    }
    let cancelled = false;
    void getForm({ path: { formUuid: route.formUuid }, responseStyle: "fields" })
      .then(({ data, error }) => {
        if (cancelled || error || data?.code !== 0 || !data.data) return;
        setResolvedFormType(data.data.formType === "defined" ? "defined" : data.data.formType === "workflow" ? "workflow" : data.data.formType === "detail" ? "detail" : "normal");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [route.formUuid]);

  if (resolvedFormType === "defined") {
    return <DefinedPageHome appId={route.appId} formUuid={route.formUuid} />;
  }

  if (resolvedFormType === null && !isSystemPageSlug(route.formUuid)) {
    return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">正在加载页面...</div>;
  }

  return <FormHomeRecords params={params} />;
}

function DefinedPageHome({ appId, formUuid }: { appId: string; formUuid: string }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canEditForm = hasPermission(`app:${appId}:edit_form`);
  const canDeleteForm = hasPermission(`app:${appId}:delete_form`);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const recordMutations = useRecordMutations(formUuid);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getForm({ path: { formUuid }, responseStyle: "fields" }),
      getFormSchema({ path: { formUuid }, query: { scope: "published" }, responseStyle: "fields" }),
    ]).then(([metadataResult, schemaResult]) => {
      if (cancelled) return;
      if (!metadataResult.error && metadataResult.data?.code === 0 && metadataResult.data.data) {
        setName(metadataResult.data.data.name);
      }
      if (!schemaResult.error && schemaResult.data?.code === 0 && schemaResult.data.data?.schema) {
        setSchema(schemaResult.data.data.schema as FormSchema);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [formUuid]);

  async function handleDelete() {
    if (!window.confirm(`确认删除“${name || formUuid}”吗？此操作会同时删除页面数据。`)) return;
    setDeleting(true);
    try {
      await recordMutations.removeForm.mutateAsync();
      notifyAppNavigationChanged(appId);
      toast.success("自定义页面已删除");
      router.replace(`/${appId}`);
    } catch {
      toast.danger("删除自定义页面失败", { description: "请确认后端服务正常。" });
    } finally {
      setDeleting(false);
    }
  }

  if (!schema) {
    return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">正在加载自定义页面...</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <Card className="theme-card-glass flex h-14 w-full shrink-0 flex-row items-center justify-between rounded-xl px-5">
        <h1 className="min-w-0 truncate text-base font-semibold text-[var(--color-text-primary)]">{name || schema.formName || formUuid}</h1>
        <div className="flex shrink-0 items-center gap-2">
          {canEditForm ? <Button variant="secondary" size="sm" onPress={() => router.push(`/designer/${formUuid}?appId=${appId}`)}><Pencil className="h-4 w-4" />编辑表单</Button> : null}
          {canDeleteForm ? <Button variant="ghost" size="sm" className="text-[var(--color-danger)]" isDisabled={deleting} onPress={() => void handleDelete()}><TrashBin className="h-4 w-4" />{deleting ? "删除中..." : "删除表单"}</Button> : null}
        </div>
      </Card>
      <main className="theme-card-glass min-h-0 w-full flex-1 overflow-auto rounded-xl p-5">
        <RuntimeFormRenderer
          schema={schema}
          submitLabel=""
          showSubmitButton={false}
          onSubmit={() => undefined}
        />
      </main>
    </div>
  );
}

function FormHomeRecords({
  params,
}: {
  params: Promise<{ appId: string; formUuid: string }>;
}) {
  const { appId, formUuid } = use(params);
  const { hasPermission } = useAuth();
  const canCreateRecord = hasPermission(`form:${formUuid}:create`);
  const canEditRecord = hasPermission(`form:${formUuid}:edit`);
  const canDeleteRecord = hasPermission(`form:${formUuid}:delete`);
  const canUseViewDevelopment = hasPermission(`app:${appId}:view_development`);
  const canEditForm = hasPermission(`app:${appId}:edit_form`);
  const canDeleteForm = hasPermission(`app:${appId}:delete_form`);
  const canImportRecords = canUseViewDevelopment;
  const canExportRecords = canUseViewDevelopment;
  const router = useRouter();
  const queryClient = useQueryClient();
  const recordMutations = useRecordMutations(formUuid);
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerValues, setDrawerValues] = useState<Record<string, unknown>>({});
  const [drawerResetKey, setDrawerResetKey] = useState(0);
  const drawerSubmitModeRef = useRef<"submit" | "continue">("submit");
  const [drafts, setDrafts] = useState<FormDraft[]>([]);
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(20);
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailFormOpen, setDetailFormOpen] = useState(false);
  const [detailSubformId, setDetailSubformId] = useState("");
  const [createdDetailSubformIds, setCreatedDetailSubformIds] = useState<Set<string>>(() => new Set());
  const [newDetailPrimaryDisplayFieldId, setNewDetailPrimaryDisplayFieldId] = useState("");
  const [newDetailSecondaryDisplayFieldId, setNewDetailSecondaryDisplayFieldId] = useState("");
  const [creatingDetailForm, setCreatingDetailForm] = useState(false);
  const [detailParentRecordUuid, setDetailParentRecordUuid] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportWorkbookState>(
    EMPTY_IMPORT_STATE,
  );
  const [agentDraftValues, setAgentDraftValues] = useState<Record<string, unknown>>({});
  const [agentValuePatch, setAgentValuePatch] = useState<{ id: number; values: Record<string, unknown> }>();
  const [openViewMenuId, setOpenViewMenuId] = useState<string | null>(null);
  const viewMenuCloseTimerRef = useRef<number | null>(null);
  const viewUrlTransitionRef = useRef<{ viewUuid: string | null } | null>(null);

  const bootstrapQuery = useFormBootstrapQuery(appId, formUuid, !isSystemPageSlug(formUuid));

  const bootstrap = bootstrapQuery.data;
  const formMetadataName = bootstrap?.metadata.name ?? "";
  const formType = bootstrap?.metadata.formType === "workflow" ? "workflow" : "normal";
  const isDetailForm = bootstrap?.metadata.formType === "detail";
  const detailFormsQuery = useDetailFormsQuery(formUuid, !isDetailForm && !isSystemPageSlug(formUuid));
  const existingDetailSubformIds = useMemo(() => new Set([
    ...(detailFormsQuery.data ?? []).map((detail) => detail.subformFieldId),
    ...createdDetailSubformIds,
  ]), [createdDetailSubformIds, detailFormsQuery.data]);
  const systemPageTitle = isSystemPageSlug(formUuid) ? (getSystemPageBySlug(formUuid)?.title ?? null) : null;
  const schema = useMemo(() => bootstrap
    ? normalizeDetailFormSchema(
        bootstrap.schema.schema as FormSchema,
        bootstrap.metadata.formType === "detail",
      )
    : null, [bootstrap]);

  const activeView: ViewKey = searchParams.get("view") === "submit" ? "submit" : "records";
  const submitButtonText = schema?.pageProps?.submitButtonText?.trim() || "提交";
  const agentConfig = schema?.pageProps?.agent;
  const agentEnabled = Boolean(agentConfig?.enabled);
  const visibleFields = useMemo(
    () => getVisibleDataFields(schema?.fields ?? []),
    [schema?.fields],
  );
  const subformFields = useMemo(
    () => (schema?.fields ?? []).filter((field) => field.type === "subform"),
    [schema?.fields],
  );
  const availableDetailSubformFields = useMemo(
    () => subformFields.filter((field) => !existingDetailSubformIds.has(field.id)),
    [existingDetailSubformIds, subformFields],
  );
  const detailDisplayFields = useMemo(
    () => (schema?.fields ?? []).filter((field) =>
      !["subform", "description", "groupContainer", "button", "link", "html", "tsx"].includes(field.type),
    ),
    [schema?.fields],
  );
  const builtinRecordFields = useMemo(
    () => formType === "workflow"
      ? [...WORKFLOW_BUILTIN_RECORD_FIELDS, ...BUILTIN_RECORD_FIELDS]
      : BUILTIN_RECORD_FIELDS,
    [formType],
  );
  const detailDisplayFieldOptions = useMemo(
    () => [
      ...detailDisplayFields.map((field) => ({ id: field.id, label: field.label })),
      ...builtinRecordFields.map((field) => ({ id: field.id, label: field.label })),
    ],
    [builtinRecordFields, detailDisplayFields],
  );
  const detailPageProps = schema?.pageProps as unknown as Record<string, unknown> | undefined;
  const detailSourceFormUuid = detailPageProps?.detailSourceFormUuid as string | undefined;
  const detailPrimaryDisplayFieldId = detailPageProps?.detailPrimaryDisplayFieldId as string | undefined ?? "instanceId";
  const detailSecondaryDisplayFieldId = detailPageProps?.detailSecondaryDisplayFieldId as string | undefined ?? "submitter";
  const allViewFields = useMemo(
    () => [
      ...visibleFields.map((field) => ({ id: field.id, label: field.label, type: field.type, typeLabel: getViewFieldTypeLabel(field.type) })),
      ...builtinRecordFields.map((field) => ({ ...field, type: "builtin", typeLabel: "内置字段" })),
    ],
    [builtinRecordFields, visibleFields],
  );
  const queryableViewFields = useMemo(
    () => allViewFields.filter((field) => !["instanceTitle", "submitterOrganization"].includes(field.id)),
    [allViewFields],
  );
  const defaultViewConfig = useMemo<ViewConfig>(() => ({
    visibleFieldIds: allViewFields.map((field) => field.id),
    sortableFieldIds: queryableViewFields.map((field) => field.id),
    filters: [],
    sorts: [],
    columnOrder: allViewFields.map((field) => field.id),
    columnWidths: {},
    frozenFieldIds: [],
  }), [allViewFields, queryableViewFields]);
  const formViews = useFormViews({ formUuid, defaultViewConfig, enabled: visibleFields.length > 0 });
  const {
    activeViewId,
    applyViewConfigDraft,
    closeViewConfig,
    confirmDeleteView,
    createTableView,
    deleteView,
    effectiveViewConfig,
    openViewConfig,
    saveViewConfig,
    setActiveViewId,
    setPendingViewConfig,
    setViewConfigDraft,
    setViewDeleteTarget,
    viewConfigDirty,
    viewConfigDraft,
    viewConfigMode,
    viewDeleteTarget,
    views,
    duplicateView,
  } = formViews;
  const viewFieldOrderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const orderedDraftViewFields = useMemo(() => {
    const order = viewConfigDraft?.columnOrder ?? allViewFields.map((field) => field.id);
    const fieldById = new Map(allViewFields.map((field) => [field.id, field]));
    const remaining = new Set(fieldById.keys());
    const ordered = order.flatMap((fieldId) => {
      const field = fieldById.get(fieldId);
      if (!field) return [];
      remaining.delete(fieldId);
      return [field];
    });
    const allOrdered = [...ordered, ...allViewFields.filter((field) => remaining.has(field.id))];
    const frozenIds = new Set(viewConfigDraft?.frozenFieldIds ?? []);
    return [...allOrdered.filter((field) => frozenIds.has(field.id)), ...allOrdered.filter((field) => !frozenIds.has(field.id))];
  }, [allViewFields, viewConfigDraft?.columnOrder, viewConfigDraft?.frozenFieldIds]);
  const handleViewFieldOrderDragEnd = useCallback((event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const sourceId = String(event.active.id).replace("view-field-", "");
    const targetId = String(event.over.id).replace("view-field-", "");
    setViewConfigDraft((current) => {
      if (!current) return current;
      const frozenIds = new Set(current.frozenFieldIds ?? []);
      if (frozenIds.has(sourceId) !== frozenIds.has(targetId)) return current;
      const currentOrder = current.columnOrder ?? allViewFields.map((field) => field.id);
      const sourceIndex = currentOrder.indexOf(sourceId);
      const targetIndex = currentOrder.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const nextOrder = [...currentOrder];
      nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, sourceId);
      return { ...current, columnOrder: nextOrder };
    });
  }, [allViewFields, setViewConfigDraft]);
  const orderedViewFieldIds = useMemo(() => {
    const visibleIds = allViewFields
      .map((field) => field.id)
      .filter((fieldId) => effectiveViewConfig.visibleFieldIds.includes(fieldId));
    const knownIds = new Set(visibleIds);
    const ordered = [
      ...(effectiveViewConfig.columnOrder ?? []).filter((fieldId) => knownIds.delete(fieldId)),
      ...visibleIds.filter((fieldId) => knownIds.has(fieldId)),
    ];
    const frozenIds = new Set(effectiveViewConfig.frozenFieldIds ?? []);
    return [...ordered.filter((fieldId) => frozenIds.has(fieldId)), ...ordered.filter((fieldId) => !frozenIds.has(fieldId))];
  }, [allViewFields, effectiveViewConfig.columnOrder, effectiveViewConfig.frozenFieldIds, effectiveViewConfig.visibleFieldIds]);
  const configuredFields = useMemo(() => {
    const fieldsById = new Map(visibleFields.map((field) => [field.id, field]));
    return orderedViewFieldIds.flatMap((fieldId) => {
      const field = fieldsById.get(fieldId);
      return field ? [field] : [];
    });
  }, [orderedViewFieldIds, visibleFields]);
  const configuredBuiltinFields = useMemo(() => {
    const fieldsById = new Map<string, { id: string; label: string }>(builtinRecordFields.map((field) => [field.id, field]));
    return orderedViewFieldIds.flatMap((fieldId) => {
      const field = fieldsById.get(fieldId);
      return field ? [field] : [];
    });
  }, [builtinRecordFields, orderedViewFieldIds]);
  const sortableFieldIds = useMemo(
    () => (effectiveViewConfig.sortableFieldIds ?? allViewFields.map((field) => field.id))
      .filter((fieldId) => effectiveViewConfig.visibleFieldIds.includes(fieldId)),
    [allViewFields, effectiveViewConfig.sortableFieldIds, effectiveViewConfig.visibleFieldIds],
  );
  const recordFilters = useMemo(() => effectiveViewConfig.filters
    .filter((rule) => rule.value.trim() && queryableViewFields.some((field) => field.id === rule.fieldId))
    .map((rule) => ({
      fieldId: rule.fieldId,
      operator: ({ contains: "contains", equals: "eq", notEquals: "neq", greaterThan: "gt", lessThan: "lt" } as const)[rule.operator],
      value: rule.value,
    })), [effectiveViewConfig.filters, queryableViewFields]);
  const recordSorts = useMemo(() => effectiveViewConfig.sorts
    .filter((rule) => queryableViewFields.some((field) => field.id === rule.fieldId))
    .map((rule) => ({
    fieldId: rule.fieldId,
    direction: rule.direction,
  })), [effectiveViewConfig.sorts, queryableViewFields]);
  const recordsQuery = useRecordsQuery({
    formUuid,
    page: recordPage,
    pageSize: recordPageSize,
    filters: recordFilters,
    sorts: recordSorts,
    detail: isDetailForm,
    enabled: Boolean(schema) && !isSystemPageSlug(formUuid),
    initialData: recordPage === 1 && recordPageSize === 20 && recordFilters.length === 0 && recordSorts.length === 0
      ? bootstrap?.records
      : undefined,
  });
  const loadingRecords = recordsQuery.isFetching;
  const displayedRecords = useMemo(
    () => (recordsQuery.data?.items ?? []) as FormRecord[],
    [recordsQuery.data?.items],
  );
  const searchableRecords = useMemo(() => displayedRecords.map((record) => ({
    record,
    searchText: Object.values(record.data).map(toSearchText).join("\u0000").toLowerCase(),
  })), [displayedRecords]);
  const searchedRecords = useMemo(() => {
    const query = deferredSearchValue.trim().toLowerCase();
    if (!query) return displayedRecords;
    return searchableRecords
      .filter((entry) => entry.searchText.includes(query))
      .map((entry) => entry.record);
  }, [deferredSearchValue, displayedRecords, searchableRecords]);
  useEffect(() => {
    if (!views.length || activeView !== "records") return;
    const requestedViewUuid = searchParams.get("viewUuid");
    const pendingTransition = viewUrlTransitionRef.current;
    if (pendingTransition && pendingTransition.viewUuid !== requestedViewUuid) return;
    const requestedView = requestedViewUuid
      ? views.find((view) => view.viewUuid === requestedViewUuid)
      : views.find((view) => view.isDefault);
    if (requestedView && requestedView.id !== activeViewId) {
      const timer = window.setTimeout(() => {
        viewUrlTransitionRef.current = null;
        setActiveViewId(requestedView.id);
        setPendingViewConfig(null);
        setViewConfigDraft(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    viewUrlTransitionRef.current = null;
  }, [activeView, activeViewId, searchParams, setActiveViewId, setPendingViewConfig, setViewConfigDraft, views]);

  async function handleCreateTableView() {
    const view = await createTableView();
    if (view) activateTableView(view);
  }

  async function handleDuplicateView(viewId: string) {
    const view = await duplicateView(viewId);
    if (view) activateTableView(view);
  }

  async function handleConfirmDeleteView() {
    const view = await confirmDeleteView();
    if (view) activateTableView(view);
  }

  function openViewMenu(viewId: string) {
    if (viewMenuCloseTimerRef.current !== null) window.clearTimeout(viewMenuCloseTimerRef.current);
    viewMenuCloseTimerRef.current = null;
    setOpenViewMenuId(viewId);
  }

  function scheduleViewMenuClose() {
    if (viewMenuCloseTimerRef.current !== null) window.clearTimeout(viewMenuCloseTimerRef.current);
    viewMenuCloseTimerRef.current = window.setTimeout(() => {
      setOpenViewMenuId(null);
      viewMenuCloseTimerRef.current = null;
    }, 160);
  }
  const handleAgentDraftValuesChange = useCallback((values: Record<string, unknown>) => {
    setAgentDraftValues(values);
    setDrawerValues(values);
  }, []);

  const refreshDrafts = useCallback(() => {
    setDrafts(readFormDrafts(formUuid));
  }, [formUuid]);

  useEffect(() => {
    const timer = window.setTimeout(refreshDrafts, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDrafts]);

  const loadRecords = useCallback(async () => {
    if (isSystemPageSlug(formUuid)) return;
    await queryClient.invalidateQueries({ queryKey: ["form-records", formUuid] });
  }, [formUuid, queryClient]);

  const parentRecordsQuery = useParentRecordsQuery(detailSourceFormUuid);
  const detailParentRecords = useMemo(
    () => (parentRecordsQuery.data?.items ?? []) as FormRecord[],
    [parentRecordsQuery.data?.items],
  );

  async function handleCreateRecord(
    values: Record<string, unknown>,
    source: "drawer" | "drawerContinue" | "page",
  ) {
    if (detailSourceFormUuid && !detailParentRecordUuid) {
      toast.danger("请选择归属主记录");
      return;
    }
    setSubmitting(true);

    try {
      await recordMutations.create.mutateAsync(detailSourceFormUuid ? { ...values, __parentRecordUuid: detailParentRecordUuid } : values);

      await loadRecords();
      toast.success("表单数据已保存", {
        description: `表单 ${formUuid} 已提交成功`,
      });

      if (source === "drawer") {
        setDrawerOpen(false);
        router.replace(`/${appId}/${formUuid}`);
      }
      if (source === "drawerContinue") {
        setDrawerValues({});
        setAgentDraftValues({});
        setAgentValuePatch(undefined);
        setDrawerResetKey((current) => current + 1);
      }
    } catch (error) {
      toast.danger("提交失败", {
        description: error instanceof Error ? error.message : "请确认后端服务正常。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateDetailForm() {
    if (!detailSubformId) return;
    if (existingDetailSubformIds.has(detailSubformId)) {
      toast.danger("该子表单已生成明细表单");
      return;
    }
    setCreatingDetailForm(true);
    try {
      const detailForm = await recordMutations.createDetailForm.mutateAsync({
          subformFieldId: detailSubformId,
          primaryDisplayFieldId: newDetailPrimaryDisplayFieldId || undefined,
          secondaryDisplayFieldId: newDetailSecondaryDisplayFieldId || undefined,
      });
      if (!detailForm) throw new Error("创建明细表单失败");
      setCreatedDetailSubformIds((current) => new Set([...current, detailSubformId]));
      setDetailFormOpen(false);
      notifyAppNavigationChanged(appId);
      router.push(`/${appId}/${detailForm?.detailFormUuid ?? ""}`);
    } catch (error) {
      toast.danger("创建明细表单失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setCreatingDetailForm(false);
    }
  }

  async function handleUpdateRecord(
    recordId: string,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    setSubmitting(true);

    try {
      await recordMutations.update.mutateAsync({ recordUuid: recordId, values });

      await loadRecords();
      toast.success("表单数据已更新", {
        description: `记录 ${recordId} 已保存`,
      });
      return true;
    } catch {
      toast.danger("更新失败", {
        description: "请确认后端服务正常。",
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWorkflowAction(record: FormRecord, action: "submit" | "reverse" | "pause" | "resume", reason?: string): Promise<boolean> {
    try {
      await runWorkflowRecordAction(formUuid, record.id, action, reason ?? "");
      await loadRecords();
      toast.success(({ submit: "流程已提交", reverse: "反审成功", pause: "流程已暂停", resume: "流程已恢复" } as Record<typeof action, string>)[action]);
      return true;
    } catch (error) {
      toast.danger("流程操作失败", { description: error instanceof Error ? error.message : "请稍后重试" });
      return false;
    }
  }

  async function handleDeleteRecord(recordId: string): Promise<boolean> {
    setDeletingRecordId(recordId);

    try {
      await recordMutations.remove.mutateAsync(recordId);

      await loadRecords();
      toast.success("记录已删除", {
        description: `记录 ${recordId} 已移除`,
      });
      return true;
    } catch {
      toast.danger("删除记录失败", {
        description: "请确认后端服务正常。",
      });
      return false;
    } finally {
      setDeletingRecordId(null);
    }
  }

  async function handleDeleteForm() {
    setDeleting(true);

    try {
      await recordMutations.removeForm.mutateAsync();

      setDeleteOpen(false);
      toast.success("表单已删除", {
        description: `表单 ${formUuid} 已移除`,
      });
      notifyAppNavigationChanged(appId);
      router.replace(`/${appId}`);
    } catch {
      toast.danger("删除表单失败", {
        description: "请确认后端服务正常。",
      });
    } finally {
      setDeleting(false);
    }
  }

  const excelFields = useMemo(
    () => visibleFields.filter((field) => !field.props?.isDisabled && !field.props?.isReadOnly && field.props?.defaultValueType !== "formula"),
    [visibleFields],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const availableIds = new Set(displayedRecords.map((record) => record.id));
      setSelectedRecordIds((current) => {
        const next = new Set([...current].filter((recordId) => availableIds.has(recordId)));
        return next.size === current.size ? current : next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [displayedRecords]);

  function toggleRecordSelection(recordId: string, selected: boolean) {
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  }

  function saveDraft() {
    const draft: FormDraft = {
      id: `draft-${Date.now()}`,
      savedAt: new Date().toISOString(),
      values: drawerValues,
    };
    const nextDrafts = [draft, ...drafts];
    writeFormDrafts(formUuid, nextDrafts);
    setDrafts(nextDrafts);
    setDrawerOpen(false);
    toast.success("草稿已暂存");
  }

  function openDraft(draft: FormDraft) {
    setDrawerValues(draft.values);
    setAgentDraftValues(draft.values);
    setAgentValuePatch(undefined);
    setDrawerResetKey((current) => current + 1);
    setIsDraftsOpen(false);
    setDrawerOpen(true);
  }

  function deleteDraft(draftId: string) {
    const nextDrafts = drafts.filter((draft) => draft.id !== draftId);
    writeFormDrafts(formUuid, nextDrafts);
    setDrafts(nextDrafts);
  }

  function submitDrawerForm(mode: "submit" | "continue") {
    if (detailSourceFormUuid && !detailParentRecordUuid) {
      toast.danger("请选择归属主记录");
      return;
    }
    drawerSubmitModeRef.current = mode;
    const form = document.getElementById("create-record-form") as HTMLFormElement | null;
    form?.requestSubmit();
  }

  async function downloadExcelTemplate() {
    const columns = buildExcelColumns(excelFields);
    const headers = [
      ...columns.map((column) => column.header),
      ...BUILTIN_RECORD_FIELDS.map((field) => field.label),
    ];
    const buffer = await buildExcelWorkbook([headers]);
    downloadExcelBuffer(buffer, `${sanitizeFileName(formMetadataName || schema?.formName || formUuid)}-导入模板.xlsx`);
  }

  async function exportSelectedRecords() {
    if (selectedRecordIds.size === 0) {
      toast.warning("请选择需要导出的数据", {
        description: "在数据行上悬停并勾选复选框后再导出。",
      });
      return;
    }

    const selectedRecords = displayedRecords.filter((record) => selectedRecordIds.has(record.id));
    const columns = buildExcelColumns(excelFields);
    const resolvedFormName = formMetadataName || schema?.formName || formUuid;
    const associationLookups = new Map<string, AssociationImportLookup>();
    try {
      await Promise.all(excelFields
        .filter((field) => field.type === "associationFormField")
        .map(async (field) => {
          const lookup = await loadAssociationImportLookup(field);
          if (lookup) associationLookups.set(field.id, lookup);
        }));
    } catch (error) {
      toast.danger("无法导出关联字段", { description: error instanceof Error ? error.message : "请检查关联表单权限和配置。" });
      return;
    }
    const matrix = [
      [
        ...columns.map((column) => column.header),
        ...BUILTIN_RECORD_FIELDS.map((field) => field.label),
      ],
      ...selectedRecords.map((record) => {
        const builtIns = getBuiltinRecordValues(record, resolvedFormName);
        return [
          ...columns.map((column) => column.field.type === "associationFormField"
            ? formatAssociationExportValue(record.data[column.field.id], associationLookups.get(column.field.id))
            : serializeExcelValue(record.data[column.field.id])),
          ...BUILTIN_RECORD_FIELDS.map((field) => builtIns[field.id]),
        ];
      }),
    ];
    const buffer = await buildExcelWorkbook(matrix);
    downloadExcelBuffer(
      buffer,
      `${sanitizeFileName(formMetadataName || schema?.formName || formUuid)}-数据-${selectedRecords.length}条.xlsx`,
    );
  }

  function openImportModal() {
    setImportState(EMPTY_IMPORT_STATE);
    setIsImportOpen(true);
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const excelColumns = buildExcelColumns(excelFields);
      const { headers, rows, mappings } = await parseExcelFile(
        await file.arrayBuffer(),
        excelColumns.map((column) => ({ id: column.field.id, label: column.field.label, header: column.header })),
      );
      setImportState({
        ...EMPTY_IMPORT_STATE,
        fileName: file.name,
        headers,
        rows,
        mappings,
      });
    } catch (reason) {
      toast.danger("无法读取 Excel", {
        description: reason instanceof Error ? reason.message : "请检查文件格式。",
      });
      setImportState(EMPTY_IMPORT_STATE);
    }
  }

  async function importExcelRows() {
    setImportState((current) => ({ ...current, importing: true, completed: false, progress: 0, successCount: 0, failureCount: 0 }));
    let successCount = 0;
    let failureCount = 0;
    const fieldMap = new Map(excelFields.map((field) => [field.id, field]));
    const associationFieldIds = [...new Set(Object.values(importState.mappings).filter((fieldId) => fieldId && fieldMap.get(fieldId)?.type === "associationFormField"))];
    const associationLookups = new Map<string, AssociationImportLookup>();

    try {
      await Promise.all(associationFieldIds.map(async (fieldId) => {
        const field = fieldMap.get(fieldId);
        if (!field) return;
        const lookup = await loadAssociationImportLookup(field);
        if (lookup) associationLookups.set(fieldId, lookup);
      }));
    } catch (error) {
      setImportState((current) => ({ ...current, importing: false }));
      toast.danger("无法解析关联字段", { description: error instanceof Error ? error.message : "请检查关联表单权限和配置。" });
      return;
    }

    for (let index = 0; index < importState.rows.length; index += 1) {
      const row = importState.rows[index];
      const data: Record<string, unknown> = {};
      for (const [columnIndexText, fieldId] of Object.entries(importState.mappings)) {
        if (!fieldId) continue;
        const field = fieldMap.get(fieldId);
        if (!field) continue;
        const cell = row[Number(columnIndexText)];
        const value = field.type === "associationFormField"
          ? resolveAssociationImportValue(cell, associationLookups.get(field.id))
          : deserializeExcelValue(field, cell);
        if (value !== undefined) data[fieldId] = value;
      }
      try {
        await recordMutations.create.mutateAsync(data);
        successCount += 1;
      } catch {
        failureCount += 1;
      }
      setImportState((current) => ({
        ...current,
        progress: Math.round(((index + 1) / importState.rows.length) * 100),
        successCount,
        failureCount,
      }));
    }

    await loadRecords();
    setImportState((current) => ({ ...current, importing: false, completed: true, progress: 100, successCount, failureCount }));
    if (failureCount === 0) toast.success("导入完成", { description: `成功导入 ${successCount} 条数据。` });
    else toast.warning("导入完成", { description: `成功 ${successCount} 条，失败 ${failureCount} 条。` });
  }

  if (systemPageTitle) {
    return <SystemPageView appId={appId} pageSlug={formUuid} pageTitle={systemPageTitle} />;
  }

  if (!schema) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <div className="theme-card-glass flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
            <div className="h-7 w-44 animate-pulse rounded bg-[var(--color-bg-panel-soft)]" />
            <div className="h-9 w-28 animate-pulse rounded-lg bg-[var(--color-bg-panel-soft)]" />
          </div>
          <div className="grid shrink-0 gap-3 border-b border-[var(--color-border)] px-5 py-4 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-[var(--color-bg-panel-soft)]" />)}
          </div>
          <div className="min-h-0 flex-1 space-y-3 p-5">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-10 animate-pulse rounded-lg bg-[var(--color-bg-panel-soft)]" />)}
          </div>
        </div>
      </div>
    );
  }

  function handleViewChange(view: ViewKey) {
    router.replace(`/${appId}/${formUuid}${view === "submit" ? "?view=submit" : ""}`);
  }

  function activateTableView(view: FormView) {
    viewUrlTransitionRef.current = { viewUuid: view.viewUuid ?? null };
    setActiveViewId(view.id);
    setPendingViewConfig(null);
    setViewConfigDraft(null);
    const query = view.viewUuid ? `?viewUuid=${encodeURIComponent(view.viewUuid)}` : "";
    router.replace(`/${appId}/${formUuid}${query}`);
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Card className="theme-card-glass mx-auto flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="mr-1 min-w-0 truncate text-xl font-semibold text-[var(--color-text-primary)]">
              {formMetadataName || schema?.formName || "表单详情"}
            </h1>
              {canCreateRecord ? <Button
                isIconOnly
                aria-label="新增"
                className="h-9 w-9 rounded-lg bg-[var(--color-primary)] p-0 text-[var(--color-text-on-primary)]"
                onClick={() => { setDrawerValues({}); setAgentDraftValues({}); setAgentValuePatch(undefined); setDrawerResetKey((current) => current + 1); setDrawerOpen(true); }}
              >
                <Plus className="h-4 w-4" />
              </Button> : null}
              {canDeleteForm ? <Button
                isIconOnly
                aria-label="删除"
                variant="ghost"
                onClick={() => setDeleteOpen(true)}
                className="h-9 w-9 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] p-0 text-[var(--color-danger)]"
              >
                <TrashBin className="h-4 w-4" />
              </Button> : null}
              {canImportRecords ? <Button
                isIconOnly
                aria-label="导入"
                variant="ghost"
                onPress={openImportModal}
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <ArrowUpFromLine className="h-4 w-4" />
              </Button> : null}
              {canExportRecords ? <Button
                isIconOnly
                aria-label="导出"
                variant="ghost"
                onPress={() => void exportSelectedRecords()}
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <ArrowDownToLine className="h-4 w-4" />
              </Button> : null}
            {canUseViewDevelopment ? <Dropdown>
                <Dropdown.Trigger
                  aria-label="更多"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-primary)]"
                >
                  <Ellipsis className="h-4 w-4" />
                </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="更多表格操作">
                  <Dropdown.Item id="create-table-view" onAction={handleCreateTableView}>
                    新增表格视图
                  </Dropdown.Item>
                  <Dropdown.Item id="drafts" onAction={() => setIsDraftsOpen(true)}>
                    <span className="flex w-full items-center justify-between gap-5">
                      草稿箱
                      <Badge color="accent" size="sm" className="!static !translate-x-0 !translate-y-0">{drafts.length}</Badge>
                    </span>
                  </Dropdown.Item>
                  <Dropdown.Item id="recycle-bin" onAction={() => router.push(`/recycle-bin?formUuid=${encodeURIComponent(formUuid)}`)}>
                    回收站
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown> : null}
            <SearchField
              aria-label="搜索数据"
              className="min-w-[220px] flex-1 sm:max-w-[300px]"
              value={searchValue}
              onChange={setSearchValue}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="搜索数据" />
                <SearchField.ClearButton aria-label="清除搜索数据" />
              </SearchField.Group>
            </SearchField>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ViewTab
              isActive={activeView === "records" && activeViewId === "default"}
              label="全部数据"
              onClick={() => {
                const defaultView = views.find((view) => view.isDefault);
                if (defaultView) activateTableView(defaultView);
              }}
            />
            {views.filter((view) => !view.isDefault).map((view) => (
              <div key={view.id} className={["inline-flex h-9 items-stretch overflow-hidden rounded-lg", activeView === "records" && activeViewId === view.id ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel-soft)]"].join(" ")}>
                <Button variant="ghost" className="h-9 min-w-0 rounded-none bg-transparent px-3 !text-[12px]" onPress={() => activateTableView(view)}><span className="!text-[12px]">{view.name}</span></Button>
                {canUseViewDevelopment ? <Dropdown isOpen={openViewMenuId === view.id} onOpenChange={(open) => setOpenViewMenuId(open ? view.id : null)}>
                  <Dropdown.Trigger onMouseEnter={() => openViewMenu(view.id)} onMouseLeave={scheduleViewMenuClose} aria-label={`${view.name}视图菜单`} className="inline-flex h-9 w-7 items-center justify-center bg-transparent">
                    <ArrowChevronDown className="h-3.5 w-3.5" />
                  </Dropdown.Trigger>
                  <Dropdown.Popover onMouseEnter={() => openViewMenu(view.id)} onMouseLeave={scheduleViewMenuClose}><Dropdown.Menu aria-label={`${view.name}操作`}>
                    <Dropdown.Item id="settings" isDisabled>表格设置（开发中）</Dropdown.Item>
                    <Dropdown.Item id="hide" isDisabled>隐藏（开发中）</Dropdown.Item>
                    <Dropdown.Item id="copy" onAction={() => handleDuplicateView(view.id)}>复制</Dropdown.Item>
                    <Dropdown.Item id="delete" onAction={() => deleteView(view.id)}>删除</Dropdown.Item>
                  </Dropdown.Menu></Dropdown.Popover>
                </Dropdown> : null}
              </div>
            ))}
            <ViewTab
              isActive={activeView === "submit"}
              label="表单提交"
              onClick={() => { setPendingViewConfig(null); setViewConfigDraft(null); handleViewChange("submit"); }}
            />
            {canUseViewDevelopment ? <><IconToolbarButton label="筛选" onPress={() => openViewConfig("filters")}><Funnel className="h-4 w-4" /></IconToolbarButton><IconToolbarButton label="显示列" onPress={() => openViewConfig("fields")}><Sliders className="h-4 w-4" /></IconToolbarButton><IconToolbarButton label="排序" onPress={() => openViewConfig("sorts")}><ArrowUpArrowDown className="h-4 w-4" /></IconToolbarButton></> : null}
            {canEditForm && !isDetailForm ? <IconToolbarButton label="表单编辑" onPress={() => router.push(`/designer/${formUuid}?appId=${appId}`)}><Pencil className="h-4 w-4" /></IconToolbarButton> : null}
            {canEditForm && !isDetailForm && subformFields.length > 0 ? <IconToolbarButton label="创建明细表单" onPress={() => { setDetailSubformId(availableDetailSubformFields[0]?.id ?? ""); setNewDetailPrimaryDisplayFieldId("instanceId"); setNewDetailSecondaryDisplayFieldId("submitter"); setDetailFormOpen(true); }}><Plus className="h-4 w-4" /></IconToolbarButton> : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {activeView === "records" ? (
            <>
            {canUseViewDevelopment && viewConfigDirty ? <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)] px-4 py-2 text-sm text-[var(--color-primary)]"><span>你调整了显示配置，是否需要保存配置？</span><Button size="sm" onPress={saveViewConfig}>保存配置</Button></div> : null}
            <RecordsTable
              key={`${activeViewId}:${JSON.stringify(effectiveViewConfig.columnWidths ?? {})}`}
              fields={configuredFields}
              builtinFields={configuredBuiltinFields}
              columnOrder={orderedViewFieldIds}
              frozenFieldIds={effectiveViewConfig.frozenFieldIds ?? []}
              formType={formType}
              sortableFieldIds={sortableFieldIds}
              columnWidths={effectiveViewConfig.columnWidths ?? {}}
              sorts={effectiveViewConfig.sorts}
              formName={formMetadataName || schema.formName || formUuid}
              schema={schema}
              records={searchedRecords as Parameters<typeof RecordsTable>[0]["records"]}
              pagination={{
                page: recordsQuery.data?.page ?? recordPage,
                pageSize: recordsQuery.data?.pageSize ?? recordPageSize,
                total: recordsQuery.data?.total ?? 0,
                onPageChange: setRecordPage,
                onPageSizeChange: (nextPageSize) => {
                  setRecordPageSize(nextPageSize);
                  setRecordPage(1);
                },
              }}
              loading={loadingRecords}
              submitting={submitting}
              deletingRecordId={deletingRecordId}
              selectedRecordIds={selectedRecordIds}
              onDeleteRecord={handleDeleteRecord}
              onUpdateRecord={handleUpdateRecord}
              onWorkflowAction={handleWorkflowAction}
              canEditRecord={canEditRecord}
              canDeleteRecord={canDeleteRecord}
              urlParams={{ appId, formUuid }}
              onRecordSelectionChange={toggleRecordSelection}
              onViewConfigChange={(patch) => {
                setRecordPage(1);
                setPendingViewConfig((current) => ({
                  ...(current ?? effectiveViewConfig),
                  ...patch,
                }));
              }}
              initialRecordId={searchParams.get("record") ?? undefined}
            />
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {detailSourceFormUuid ? (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[var(--color-text-secondary)]">归属主记录</div>
                    <div className="mt-0.5 truncate text-sm text-[var(--color-text-primary)]">
                      {detailParentRecordUuid ? getDetailParentRecordLabel(detailParentRecords.find((record) => record.id === detailParentRecordUuid), detailPrimaryDisplayFieldId, detailSecondaryDisplayFieldId, detailParentRecordUuid) : "请选择此明细数据归属的主记录"}
                    </div>
                  </div>
                  <Dropdown>
                    <Dropdown.Trigger aria-label="选择归属主记录" className="inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 text-xs text-[var(--color-text-primary)]">
                      选择记录
                    </Dropdown.Trigger>
                    <Dropdown.Popover><Dropdown.Menu aria-label="选择归属主记录">
                      {detailParentRecords.map((record) => <Dropdown.Item key={record.id} id={record.id} onAction={() => setDetailParentRecordUuid(record.id)}>{getDetailParentRecordLabel(record, detailPrimaryDisplayFieldId, detailSecondaryDisplayFieldId)}</Dropdown.Item>)}
                      {detailParentRecords.length === 0 ? <Dropdown.Item id="empty" isDisabled>暂无可选主记录</Dropdown.Item> : null}
                    </Dropdown.Menu></Dropdown.Popover>
                  </Dropdown>
                </div>
              ) : null}
              <RuntimeFormSurface><RuntimeFormPanel
                schema={schema}
                submitLabel={submitButtonText}
                submitting={submitting}
                urlParams={{ appId, formUuid }}
                onSubmit={(values) => handleCreateRecord(values, "page")}
              /></RuntimeFormSurface>
            </div>
          )}
        </div>
      </Card>

      <Modal isOpen={detailFormOpen} onOpenChange={setDetailFormOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="theme-menu-surface rounded-2xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">创建明细表单</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body className="space-y-4 px-5 py-4">
                <label className="block space-y-1.5 text-sm font-medium text-[var(--color-text-primary)]">
                  <span>子表单</span>
                  <Select aria-label="子表单" selectedKey={detailSubformId} onSelectionChange={(key) => setDetailSubformId(String(key ?? ""))}>
                    <Select.Trigger><Select.Value>{availableDetailSubformFields.find((field) => field.id === detailSubformId)?.label ?? "选择子表单"}</Select.Value></Select.Trigger>
                    <Select.Popover><ListBox>{availableDetailSubformFields.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}{availableDetailSubformFields.length === 0 ? <ListBox.Item id="empty" isDisabled>所有子表单均已生成明细表单</ListBox.Item> : null}</ListBox></Select.Popover>
                  </Select>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0 space-y-1.5 text-sm font-medium text-[var(--color-text-primary)]">
                    <span>主显示字段</span>
                    <DetailDisplayFieldSelect ariaLabel="主显示字段" options={detailDisplayFieldOptions} selectedKey={newDetailPrimaryDisplayFieldId} onSelectionChange={setNewDetailPrimaryDisplayFieldId} />
                  </label>
                  <label className="block min-w-0 space-y-1.5 text-sm font-medium text-[var(--color-text-primary)]">
                    <span>次级显示字段</span>
                    <DetailDisplayFieldSelect ariaLabel="次级显示字段" options={detailDisplayFieldOptions.filter((field) => field.id !== newDetailPrimaryDisplayFieldId)} selectedKey={newDetailSecondaryDisplayFieldId} onSelectionChange={setNewDetailSecondaryDisplayFieldId} />
                  </label>
                </div>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
                <Button variant="ghost" isDisabled={creatingDetailForm} onPress={() => setDetailFormOpen(false)}>取消</Button>
                <Button isDisabled={creatingDetailForm || !detailSubformId || existingDetailSubformIds.has(detailSubformId)} onPress={() => void handleCreateDetailForm()}>{creatingDetailForm ? "创建中..." : "确定"}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
          <Drawer.Content placement="right">
            <Drawer.Dialog className={`theme-menu-surface flex h-[100dvh] flex-col overflow-hidden shadow-[var(--shadow-dialog)] ${agentEnabled ? "w-[90vw] max-w-[90vw]" : "w-[min(1180px,100vw)] max-w-[100vw]"}`}>
              <Drawer.Header className="border-b border-[var(--color-border)] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Drawer.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                      新增数据
                    </Drawer.Heading>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      {agentEnabled ? "填写表单，并让 Agent 协助处理当前业务。" : "使用已发布的表单设计填写并提交数据。"}
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    onClick={() => setDrawerOpen(false)}
                    className="h-10 w-10 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]"
                  >
                    ×
                  </Button>
                </div>
              </Drawer.Header>
              <Drawer.Body className={agentEnabled ? "min-h-0 flex-1 overflow-hidden" : "flex-1 overflow-y-auto bg-[var(--designer-surface-soft)] p-5"}>
                <div className={agentEnabled ? "flex h-full min-h-0" : "contents"}>
                  <div className={agentEnabled ? "min-h-0 min-w-0 flex-1 overflow-y-auto mr-2" : "contents"}>
                    {detailSourceFormUuid ? (
                      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--color-text-secondary)]">归属主记录</div>
                          <div className="mt-0.5 truncate text-sm text-[var(--color-text-primary)]">
                            {detailParentRecordUuid ? getDetailParentRecordLabel(detailParentRecords.find((record) => record.id === detailParentRecordUuid), detailPrimaryDisplayFieldId, detailSecondaryDisplayFieldId, detailParentRecordUuid) : "请选择此明细数据归属的主记录"}
                          </div>
                        </div>
                        <Dropdown>
                          <Dropdown.Trigger aria-label="选择归属主记录" className="inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 text-xs text-[var(--color-text-primary)]">
                            选择记录
                          </Dropdown.Trigger>
                          <Dropdown.Popover>
                            <Dropdown.Menu aria-label="选择归属主记录">
                              {detailParentRecords.map((record) => (
                                <Dropdown.Item key={record.id} id={record.id} onAction={() => setDetailParentRecordUuid(record.id)}>
                                  {getDetailParentRecordLabel(record, detailPrimaryDisplayFieldId, detailSecondaryDisplayFieldId)}
                                </Dropdown.Item>
                              ))}
                              {detailParentRecords.length === 0 ? <Dropdown.Item id="empty" isDisabled>暂无可选主记录</Dropdown.Item> : null}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>
                    ) : null}
                    <RuntimeFormSurface><RuntimeFormPanel
                      key={drawerResetKey}
                      formId="create-record-form"
                      schema={schema}
                      initialValues={drawerValues}
                      showSubmitButton={false}
                      submitLabel={submitButtonText}
                      submitting={submitting}
                      urlParams={{ appId, formUuid }}
                      onValuesChange={handleAgentDraftValuesChange}
                      valuePatch={agentValuePatch}
                      onSubmit={(values) => handleCreateRecord(values, drawerSubmitModeRef.current === "continue" ? "drawerContinue" : "drawer")}
                    /></RuntimeFormSurface>
                  </div>
                  {agentEnabled && drawerOpen ? (
                    <FormAgentPanel
                      key={`${agentConfig?.agentId ?? ""}:${formUuid}`}
                      agentId={agentConfig?.agentId ?? ""}
                      appId={appId}
                      formName={formMetadataName || schema.formName || formUuid}
                      formUuid={formUuid}
                      prompt={agentConfig?.prompt ?? ""}
                      fields={schema.fields}
                      currentValues={agentDraftValues}
                      analysis={agentConfig?.context?.status === "ready" ? (agentConfig.context.overrides?.trim() || agentConfig.context.generated?.trim() || "") : ""}
                      onApplyValues={(values) => setAgentValuePatch({ id: Date.now(), values })}
                    />
                  ) : null}
                </div>
              </Drawer.Body>
              <Drawer.Footer className="flex shrink-0 justify-between gap-3">
                <Button variant="ghost" isDisabled={submitting} onPress={saveDraft}>暂存</Button>
                <div className="flex items-center gap-3">
                  <Button variant="ghost" isDisabled={submitting} onPress={() => setDrawerOpen(false)}>取消</Button>
                   <Button variant="secondary" isDisabled={submitting || Boolean(detailSourceFormUuid && !detailParentRecordUuid)} onPress={() => submitDrawerForm("continue")}>提交并继续</Button>
                   <Button isDisabled={submitting || Boolean(detailSourceFormUuid && !detailParentRecordUuid)} onPress={() => submitDrawerForm("submit")}>{submitting ? "提交中..." : "提交"}</Button>
                </div>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Modal isOpen={isDraftsOpen} onOpenChange={setIsDraftsOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" scroll="inside" size="lg">
            <Modal.Dialog className="theme-menu-surface flex max-h-[80vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">草稿箱</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭草稿箱" />
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {drafts.map((draft) => (
                  <div key={draft.id} className="flex items-center justify-between gap-4 border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">{formMetadataName || schema.formName || "表单"}草稿</div>
                      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">暂存于 {formatDateTime(draft.savedAt)} · 已填写 {Object.values(draft.values).filter((value) => value !== "" && value !== undefined && value !== null).length} 项</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="ghost" className="text-[var(--color-danger)]" onPress={() => deleteDraft(draft.id)}>删除</Button>
                      <Button size="sm" onPress={() => openDraft(draft)}>继续编辑</Button>
                    </div>
                  </div>
                ))}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Drawer isOpen={viewConfigMode !== null} onOpenChange={(open) => { if (!open) closeViewConfig(); }}>
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
          <Drawer.Content placement="right">
            <Drawer.Dialog className="theme-menu-surface flex h-[100dvh] w-[min(620px,100vw)] max-w-[100vw] flex-col overflow-hidden shadow-[var(--shadow-dialog)]">
              <Drawer.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Drawer.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {viewConfigMode === "filters" ? "筛选" : viewConfigMode === "fields" ? "显示列" : "排序"}
                </Drawer.Heading>
                <Drawer.CloseTrigger aria-label="关闭配置" />
              </Drawer.Header>
              <Drawer.Body className="min-h-0 flex-1 overflow-y-auto">
                {viewConfigDraft && viewConfigMode === "filters" ? (
                  <div className="space-y-3">
                    {viewConfigDraft.filters.map((rule) => (
                      <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_36px] items-center gap-2">
                        <Select selectedKey={rule.fieldId} aria-label="筛选字段" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.map((item) => item.id === rule.id ? { ...item, fieldId: String(key ?? "") } : item) } : current)}>
                          <Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox>{queryableViewFields.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover>
                        </Select>
                        <Select selectedKey={rule.operator} aria-label="筛选条件" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.map((item) => item.id === rule.id ? { ...item, operator: String(key) as ViewFilterOperator } : item) } : current)}>
                          <Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="contains">包含</ListBox.Item><ListBox.Item id="equals">等于</ListBox.Item><ListBox.Item id="notEquals">不等于</ListBox.Item><ListBox.Item id="greaterThan">大于</ListBox.Item><ListBox.Item id="lessThan">小于</ListBox.Item></ListBox></Select.Popover>
                        </Select>
                        <Input aria-label="筛选值" value={rule.value} placeholder="请输入值" onChange={(event) => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item) } : current)} />
                        <Button isIconOnly variant="ghost" aria-label="删除筛选条件" onPress={() => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.filter((item) => item.id !== rule.id) } : current)}><TrashBin className="h-4 w-4" /></Button>
                      </div>
                    ))}
                    <Button variant="ghost" className="text-[var(--color-primary)]" onPress={() => setViewConfigDraft((current) => current ? { ...current, filters: [...current.filters, { id: `filter-${Date.now()}`, fieldId: queryableViewFields[0]?.id ?? "", operator: "contains", value: "" }] } : current)}>+ 添加筛选条件</Button>
                  </div>
                ) : null}
                {viewConfigDraft && viewConfigMode === "fields" ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--color-text-secondary)]">使用图钉冻结列到左侧；冻结列与普通列只能在各自分组内拖拽排序。</p>
                    <Card className="overflow-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1 shadow-none">
                      <div className="view-column-config-grid min-w-[480px]">
                        <div className="view-column-config-grid__header items-center border-b border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]">
                          <span>字段</span>
                          <span>字段类型</span>
                          <span className="text-center">显示列</span>
                          <span className="text-center">排序按钮</span>
                          <span className="text-center">宽</span>
                          <span className="text-center">操作</span>
                        </div>
                        <DndContext sensors={viewFieldOrderSensors} onDragEnd={handleViewFieldOrderDragEnd}>
                          {orderedDraftViewFields.map((field) => <ReorderableViewFieldRow key={field.id} field={field} config={viewConfigDraft} onConfigChange={setViewConfigDraft} />)}
                        </DndContext>
                      </div>
                    </Card>
                  </div>
                ) : null}
                {viewConfigDraft && viewConfigMode === "sorts" ? (
                  <div className="space-y-3">
                    {viewConfigDraft.sorts.map((rule) => <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_130px_36px] items-center gap-2"><Select selectedKey={rule.fieldId} aria-label="排序字段" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, sorts: current.sorts.map((item) => item.id === rule.id ? { ...item, fieldId: String(key ?? "") } : item) } : current)}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox>{queryableViewFields.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover></Select><Select selectedKey={rule.direction} aria-label="排序方向" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, sorts: current.sorts.map((item) => item.id === rule.id ? { ...item, direction: String(key) as "asc" | "desc" } : item) } : current)}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="asc">升序</ListBox.Item><ListBox.Item id="desc">降序</ListBox.Item></ListBox></Select.Popover></Select><Button isIconOnly variant="ghost" aria-label="删除排序规则" onPress={() => setViewConfigDraft((current) => current ? { ...current, sorts: current.sorts.filter((item) => item.id !== rule.id) } : current)}><TrashBin className="h-4 w-4" /></Button></div>)}
                    <Button variant="ghost" className="text-[var(--color-primary)]" onPress={() => setViewConfigDraft((current) => current ? { ...current, sorts: [...current.sorts, { id: `sort-${Date.now()}`, fieldId: allViewFields[0]?.id ?? "", direction: "asc" }] } : current)}>+ 添加排序规则</Button>
                  </div>
                ) : null}
              </Drawer.Body>
              <Drawer.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-4"><Button variant="ghost" onPress={closeViewConfig}>取消</Button><Button onPress={applyViewConfigDraft}>应用调整</Button></Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Drawer
        isOpen={isImportOpen}
        onOpenChange={(open) => {
          if (!importState.importing) setIsImportOpen(open);
        }}
      >
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable={false}>
          <Drawer.Content placement="right" className="!justify-end">
            <Drawer.Dialog className="theme-menu-surface flex h-[100dvh] w-[min(720px,100vw)] max-w-[100vw] flex-col overflow-hidden shadow-[var(--shadow-dialog)]">
              <Drawer.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <div>
                  <Drawer.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">导入表单数据</Drawer.Heading>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">按分组完成上传、字段匹配和导入。</p>
                </div>
                <Drawer.CloseTrigger aria-label="关闭导入" isDisabled={importState.importing} />
              </Drawer.Header>
              <Drawer.Body className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-[var(--color-bg-subtle)] px-5 py-5">
                <section className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
                  <div className="flex items-start gap-3"><Badge color="accent" className="!static !translate-x-0 !translate-y-0">1</Badge><div><h3 className="text-sm font-semibold text-[var(--color-text-primary)]">上传 Excel</h3><p className="mt-1 text-xs text-[var(--color-text-secondary)]">下载模板并上传填写后的文件。</p></div></div>
                  <Button variant="secondary" onPress={() => void downloadExcelTemplate()}><ArrowDownToLine className="h-4 w-4" />下载 Excel 模板</Button>
                  <Input key={importState.fileName || "empty-import-file"} fullWidth type="file" accept=".xlsx,.xls" aria-label="上传导入 Excel" onChange={handleImportFileChange} />
                  {importState.fileName ? <div className="rounded-lg border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">已读取 {importState.fileName}，共 {importState.rows.length} 条数据、{importState.headers.length} 列</div> : null}
                </section>

                <section className={`space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 ${importState.rows.length === 0 ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-3"><Badge color={importState.rows.length ? "accent" : "default"} className="!static !translate-x-0 !translate-y-0">2</Badge><div><h3 className="text-sm font-semibold text-[var(--color-text-primary)]">匹配导入字段</h3><p className="mt-1 text-xs text-[var(--color-text-secondary)]">选择 Excel 列写入的表单字段，不需要的列可忽略。</p></div></div>
                  {importState.rows.length ? <div className="space-y-3">{importState.headers.map((header, columnIndex) => <div key={`${header}-${columnIndex}`} className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2"><div className="min-w-0"><div className="truncate text-sm text-[var(--color-text-primary)]">{header || `未命名列 ${columnIndex + 1}`}</div>{BUILTIN_RECORD_FIELD_LABELS.has(header) ? <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">系统字段，导入时自动生成</div> : null}</div><span className="text-center text-[var(--color-text-disabled)]">→</span><Select aria-label={`匹配 ${header || `第 ${columnIndex + 1} 列`}`} isDisabled={BUILTIN_RECORD_FIELD_LABELS.has(header)} selectedKey={importState.mappings[columnIndex] || "__ignore__"} onSelectionChange={(key) => setImportState((current) => ({ ...current, mappings: { ...current.mappings, [columnIndex]: key === "__ignore__" || key === null ? "" : String(key) } }))}><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="__ignore__" textValue="忽略此列">忽略此列</ListBox.Item>{excelFields.map((field) => <ListBox.Item key={field.id} id={field.id} textValue={field.label}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover></Select></div>)}</div> : <p className="text-xs text-[var(--color-text-secondary)]">上传 Excel 后可配置字段匹配。</p>}
                </section>

                <section className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
                  <div className="flex items-start gap-3"><Badge color={importState.completed || importState.importing ? "accent" : "default"} className="!static !translate-x-0 !translate-y-0">3</Badge><div><h3 className="text-sm font-semibold text-[var(--color-text-primary)]">导入数据</h3><p className="mt-1 text-xs text-[var(--color-text-secondary)]">确认映射后开始逐条写入。</p></div></div>
                  {importState.importing || importState.completed ? <div className="text-center"><div className="text-base font-semibold text-[var(--color-text-primary)]">{importState.completed ? "导入完成" : "正在导入数据"}</div><p className="mt-2 text-sm text-[var(--color-text-secondary)]">{importState.completed ? `成功 ${importState.successCount} 条，失败 ${importState.failureCount} 条` : `正在逐条写入，共 ${importState.rows.length} 条数据`}</p><ProgressBar aria-label="导入进度" value={importState.progress} className="mt-5"><div className="mb-2 flex justify-between text-xs text-[var(--color-text-secondary)]"><span>{importState.successCount} 条成功</span><ProgressBar.Output>{importState.progress}%</ProgressBar.Output></div><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>{importState.failureCount > 0 ? <p className="mt-3 text-xs text-[var(--color-danger)]">有 {importState.failureCount} 条数据导入失败。</p> : null}</div> : <p className="text-xs text-[var(--color-text-secondary)]">完成前两组设置后开始导入。</p>}
                </section>
              </Drawer.Body>
              <Drawer.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-4">
                <Button
                  variant="ghost"
                  isDisabled={importState.importing}
                  onPress={() => setIsImportOpen(false)}
                >
                  关闭
                </Button>
                <Button isDisabled={importState.importing || importState.completed || !Object.values(importState.mappings).some(Boolean) || importState.rows.length === 0} onPress={() => void importExcelRows()}>{importState.importing ? "导入中…" : "开始导入"}</Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <AlertDialog isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Backdrop className="theme-modal-backdrop">
          <AlertDialog.Container placement="center" size="md">
            <AlertDialog.Dialog className="theme-menu-surface rounded-2xl shadow-[var(--shadow-dialog)]">
              <AlertDialog.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <AlertDialog.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  删除表单
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">
                删除后，表单设计、提交记录和导航项都会被移除。
              </AlertDialog.Body>
              <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteOpen(false)}
                  className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-4 text-[var(--color-text-primary)]"
                >
                  取消
                </Button>
                <Button
                  onClick={handleDeleteForm}
                  isDisabled={deleting}
                  className="h-10 rounded-lg bg-[var(--color-danger)] px-4 text-[var(--color-text-on-primary)]"
                >
                  {deleting ? "删除中..." : "确认删除"}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog
        isOpen={viewDeleteTarget !== null}
        onOpenChange={(isOpen) => !isOpen && setViewDeleteTarget(null)}
      >
        <AlertDialog.Backdrop className="theme-modal-backdrop">
          <AlertDialog.Container placement="center" size="md">
            <AlertDialog.Dialog className="theme-menu-surface rounded-xl shadow-[var(--shadow-dialog)]">
              <AlertDialog.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <AlertDialog.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  删除视图
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">
                {viewDeleteTarget ? `确认删除视图“${viewDeleteTarget.name}”吗？此操作无法恢复。` : ""}
              </AlertDialog.Body>
              <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
                <Button variant="ghost" onPress={() => setViewDeleteTarget(null)}>
                  取消
                </Button>
                <Button
                  isDisabled={viewDeleteTarget === null}
                  className="bg-[var(--color-danger)] text-[var(--color-text-on-primary)]"
                  onPress={handleConfirmDeleteView}
                >
                  确认删除
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}

function ViewTab({
  isActive,
  label,
  onClick,
}: {
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={[
        "h-9 rounded-lg px-3 !text-[12px]",
        isActive
          ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
          : "border border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel-soft)]",
      ].join(" ")}
    >
      <span className="!text-[12px]">{label}</span>
    </Button>
  );
}

function IconToolbarButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Button isIconOnly variant="ghost" aria-label={label} onPress={onPress} className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]">
      {children}
    </Button>
  );
}

function toSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(toSearchText).join(" ");
  if (typeof value === "object") return Object.values(value).map(toSearchText).join(" ");
  return "";
}
