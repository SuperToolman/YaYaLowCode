"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Checkbox, Dropdown, Link as HeroLink, ListBox, Select, Table, TextArea, toast, type Selection, type SortDescriptor } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Drawer } from "@heroui/react/drawer";
import { Modal } from "@heroui/react/modal";
import { Pagination } from "@heroui/react/pagination";
import { ArrowChevronLeft, ArrowChevronRight, ArrowUpArrowDown, ArrowsExpand, Copy, Ellipsis, Eye, TrashBin, Xmark } from "@gravity-ui/icons";
import { RuntimeFormRenderer, RuntimeFormSurface, type RuntimeFormSchema, type RuntimeSchemaField } from "../../../components/runtime-form-renderer";
import { getFormSchema, listFormRecords } from "../../../lib/api-client";
import { DetailAuxiliaryPanel } from "./record-detail-auxiliary-panel";
import { DetailBuiltIn, getPaginationPageNumbers } from "./records-table-primitives";
import { estimateTableColumnWidth, getAssociationPrimaryValue, getAssociationRecordId, getBuiltinRecordValues, getTableFieldDisplayValue } from "./form-record-utils";
import type { ViewConfig, ViewSortRule } from "./use-form-views";

type SchemaField = RuntimeSchemaField;
type FormSchema = RuntimeFormSchema;
type FormRecord = { id: string; formUuid: string; schemaVersion: number; data: Record<string, unknown>; createdBy: string; createdByUserId?: string | null; createdByAvatarUrl?: string | null; submitterOrganization?: string | null; updatedBy: string; createdAt: string; updatedAt: string };
type RecordTableRow = FormRecord & { rowNumber: number; displayValues: { fields: Record<string, string>; builtIns: Record<string, string> } };
type AssociationFormData = { schema: FormSchema; records: Map<string, FormRecord> };
type AssociationDetail = { field: SchemaField; record: FormRecord; schema: FormSchema };

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("当前浏览器不支持复制");
}

function normalizeColumnWidth(width: number | string) {
  if (typeof width === "number") return Number.isFinite(width) ? width : null;
  const matched = width.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/);
  return matched ? Number(matched[1]) : null;
}

function getDynamicColumnWidth(label: string, values: string[], sortable: boolean, maxWidth: number) {
  const titleWidth = estimateTableColumnWidth([label], 24, maxWidth) + (sortable ? 20 : 0);
  const contentWidth = estimateTableColumnWidth(values, 24, maxWidth);
  return Math.min(maxWidth, Math.max(titleWidth, contentWidth));
}

export const RuntimeFormPanel = memo(function RuntimeFormPanel({
  formId,
  initialValues,
  isReadOnly,
  onValuesChange,
  schema,
  showSubmitButton,
  submitLabel,
  submitting,
  urlParams,
  valuePatch,
  onSubmit,
}: {
  formId?: string;
  initialValues?: Record<string, unknown>;
  isReadOnly?: boolean;
  onValuesChange?: (values: Record<string, unknown>) => void;
  schema: FormSchema;
  showSubmitButton?: boolean;
  submitLabel: string;
  submitting: boolean;
  urlParams: Record<string, string>;
  valuePatch?: { id: number; values: Record<string, unknown> };
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <RuntimeFormRenderer
      initialValues={initialValues}
      formId={formId}
      isReadOnly={isReadOnly}
      onValuesChange={onValuesChange}
      schema={schema}
      showSubmitButton={showSubmitButton}
      submitLabel={submitLabel}
      submitting={submitting}
      urlParams={urlParams}
      valuePatch={valuePatch}
      onSubmit={onSubmit}
    />
  );
});

export function RecordsTable({
  builtinFields,
  columnOrder,
  columnWidths: savedColumnWidths,
  frozenFieldIds,
  sorts,
  sortableFieldIds,
  deletingRecordId,
  fields,
  formType,
  formName,
  schema,
  records,
  selectedRecordIds,
  loading,
  submitting,
  onDeleteRecord,
  onUpdateRecord,
  onWorkflowAction,
  canEditRecord,
  canDeleteRecord,
  urlParams,
  onRecordSelectionChange,
  onViewConfigChange,
  initialRecordId,
}: {
  builtinFields: readonly { id: string; label: string }[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  frozenFieldIds: string[];
  sorts: ViewSortRule[];
  sortableFieldIds: string[];
  deletingRecordId: string | null;
  fields: SchemaField[];
  formType: "normal" | "workflow";
  formName: string;
  schema: FormSchema;
  records: FormRecord[];
  selectedRecordIds: Set<string>;
  loading: boolean;
  submitting: boolean;
  onDeleteRecord: (recordId: string) => Promise<boolean>;
  onUpdateRecord: (recordId: string, values: Record<string, unknown>) => Promise<boolean>;
  onWorkflowAction: (record: FormRecord, action: "submit" | "reverse" | "pause" | "resume", reason?: string) => Promise<boolean>;
  canEditRecord: boolean;
  canDeleteRecord: boolean;
  urlParams: Record<string, string>;
  onRecordSelectionChange: (recordId: string, selected: boolean) => void;
  onViewConfigChange: (patch: Partial<Pick<ViewConfig, "columnOrder" | "columnWidths" | "sorts">>) => void;
  initialRecordId?: string;
}) {
  const pageSizeOptions = [10, 20, 30, 40, 50];
  const columns = fields;
  const tableColumns = useMemo(() => {
    const businessColumns = new Map(columns.map((field, index) => [field.id, { kind: "field" as const, field, index }]));
    const builtInColumns = new Map(builtinFields.map((field, index) => [field.id, { kind: "builtin" as const, field, index }]));
    const ordered: Array<{ kind: "field"; field: SchemaField; index: number } | { kind: "builtin"; field: { id: string; label: string }; index: number }> = [];

    columnOrder.forEach((id) => {
      const column = businessColumns.get(id) ?? builtInColumns.get(id);
      if (!column) return;
      ordered.push(column);
      businessColumns.delete(id);
      builtInColumns.delete(id);
    });

    return [...ordered, ...businessColumns.values(), ...builtInColumns.values()];
  }, [builtinFields, columnOrder, columns]);
  const [detailRecord, setDetailRecord] = useState<FormRecord | null>(null);
  const autoOpenedRecordIdRef = useRef<string | null>(null);
  const [isDetailEditing, setIsDetailEditing] = useState(false);
  const [detailTab, setDetailTab] = useState<"comments" | "history">("comments");
  const [pauseTarget, setPauseTarget] = useState<FormRecord | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [isDetailFullscreen, setIsDetailFullscreen] = useState(false);
  const [deleteRecordTarget, setDeleteRecordTarget] = useState<FormRecord | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const resizingColumnIdRef = useRef<string | null>(null);
  const [isDetailContentReady, setIsDetailContentReady] = useState(false);
  const [associationForms, setAssociationForms] = useState<Map<string, AssociationFormData>>(
    () => new Map(),
  );
  const [associationDetail, setAssociationDetail] = useState<AssociationDetail | null>(null);
  const associationFormIds = useMemo(
    () => [...new Set(columns
      .filter((field) => field.type === "associationFormField" && field.props?.associationFormId)
      .map((field) => field.props!.associationFormId!))],
    [columns],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadAssociationForms() {
      if (associationFormIds.length === 0) {
        setAssociationForms(new Map());
        return;
      }

      const results = await Promise.all(associationFormIds.map(async (associationFormId) => {
        const [schemaResult, recordsResult] = await Promise.all([
          getFormSchema({
            path: { formUuid: associationFormId },
            query: { scope: "published" },
            responseStyle: "fields",
          }),
          listFormRecords({
            path: { formUuid: associationFormId },
            query: { page: 1, pageSize: 100 },
            responseStyle: "fields",
          }),
        ]);
        const schema = schemaResult.data?.code === 0 ? schemaResult.data.data?.schema : null;
        const relatedRecords = recordsResult.data?.code === 0 ? recordsResult.data.data?.items : null;
        if (schemaResult.error || recordsResult.error || !schema || !relatedRecords) return null;

        return [associationFormId, {
          schema: schema as FormSchema,
          records: new Map((relatedRecords as FormRecord[]).map((record) => [record.id, record])),
        }] as const;
      }));

      if (!cancelled) {
        setAssociationForms(new Map(results.filter((result): result is readonly [string, AssociationFormData] => result !== null)));
      }
    }

    void loadAssociationForms();
    return () => {
      cancelled = true;
    };
  }, [associationFormIds]);
  const recordDisplayValues = useMemo(() => {
    const values = new Map<string, {
      fields: Record<string, string>;
      builtIns: Record<string, string>;
    }>();

    records.forEach((record) => {
      values.set(record.id, {
        fields: Object.fromEntries(columns.map((field) => [
          field.id,
          getTableFieldDisplayValue(field, record, associationForms),
        ])),
        builtIns: getBuiltinRecordValues(record, formName, formType === "workflow"),
      });
    });

    return values;
  }, [associationForms, columns, formName, formType, records]);
  const businessColumnWidths = useMemo(
    () => columns.map((field) => getDynamicColumnWidth(
      field.label,
      records.map((record) => recordDisplayValues.get(record.id)?.fields[field.id] ?? ""),
      sortableFieldIds.includes(field.id),
      320,
    )),
    [columns, recordDisplayValues, records, sortableFieldIds],
  );
  const builtInColumnMaxWidths = useMemo(
    () => builtinFields.map((field) => field.id === "instanceTitle" ? 360 : 260),
    [builtinFields],
  );
  const builtInColumnWidths = useMemo(
    () => builtinFields.map((field, index) => getDynamicColumnWidth(
      field.label,
      records.map((record) => recordDisplayValues.get(record.id)?.builtIns[field.id] ?? ""),
      sortableFieldIds.includes(field.id),
      builtInColumnMaxWidths[index],
    )),
    [builtInColumnMaxWidths, builtinFields, recordDisplayValues, records, sortableFieldIds],
  );
  const sequenceColumnWidth = useMemo(() => (
    estimateTableColumnWidth(
      records.map((_, index) => String(index + 1)),
      24,
      160,
    )
  ), [records]);
  const frozenColumnOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    const frozenIds = new Set(frozenFieldIds);
    let offset = sequenceColumnWidth;

    tableColumns.forEach((column) => {
      if (!frozenIds.has(column.field.id)) return;
      offsets.set(column.field.id, offset);
      offset += savedColumnWidths[column.field.id] ?? (column.kind === "field"
        ? businessColumnWidths[column.index]
        : builtInColumnWidths[column.index]);
    });
    return offsets;
  }, [builtInColumnWidths, businessColumnWidths, frozenFieldIds, savedColumnWidths, sequenceColumnWidth, tableColumns]);
  const tableMinimumWidth = useMemo(() => (
    Math.max(44, sequenceColumnWidth)
    + 180
    + tableColumns.reduce((total, column) => total + (savedColumnWidths[column.field.id] ?? (
      column.kind === "field" ? businessColumnWidths[column.index] : builtInColumnWidths[column.index]
    )), 0)
  ), [builtInColumnWidths, businessColumnWidths, savedColumnWidths, sequenceColumnWidth, tableColumns]);
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const pageStart = (activePage - 1) * pageSize;
  const pageRecords = records.slice(pageStart, pageStart + pageSize);
  const tableRows = useMemo<RecordTableRow[]>(
    () => pageRecords.map((record, index) => ({
      ...record,
      rowNumber: pageStart + index + 1,
      displayValues: recordDisplayValues.get(record.id)!,
    })),
    [pageRecords, pageStart, recordDisplayValues],
  );
  const allCurrentPageSelected = pageRecords.length > 0 && pageRecords.every((record) => selectedRecordIds.has(record.id));
  const activeSort = sorts[0];
  const sortDescriptor = useMemo<SortDescriptor | undefined>(() => activeSort ? {
    column: activeSort.fieldId,
    direction: activeSort.direction === "asc" ? "ascending" : "descending",
  } : undefined, [activeSort]);
  const handleSortChange = useCallback((descriptor: SortDescriptor) => {
    const columnId = String(descriptor.column);
    onViewConfigChange({
      sorts: [
        { id: `header-sort-${columnId}`, fieldId: columnId, direction: descriptor.direction === "ascending" ? "asc" : "desc" },
        ...sorts.filter((rule) => rule.fieldId !== columnId),
      ],
    });
  }, [onViewConfigChange, sorts]);
  const handleColumnResizeEnd = useCallback((widths: Map<string | number, number | string>) => {
    const columnId = resizingColumnIdRef.current;
    resizingColumnIdRef.current = null;
    if (!columnId) return;
    const width = widths.get(columnId);
    if (width === undefined) return;
    const normalizedWidth = normalizeColumnWidth(width);
    if (normalizedWidth === null) return;
    onViewConfigChange({ columnWidths: { ...savedColumnWidths, [columnId]: normalizedWidth } });
  }, [onViewConfigChange, savedColumnWidths]);
  const handleSelectionChange = useCallback((keys: Selection) => {
    const nextSelectedIds = keys === "all"
      ? new Set(pageRecords.map((record) => record.id))
      : new Set([...keys].map(String));
    pageRecords.forEach((record) => onRecordSelectionChange(record.id, nextSelectedIds.has(record.id)));
  }, [onRecordSelectionChange, pageRecords]);
  const toggleCurrentPageSelection = useCallback((selected: boolean) => {
    pageRecords.forEach((record) => onRecordSelectionChange(record.id, selected));
  }, [onRecordSelectionChange, pageRecords]);
  const paginationPages = getPaginationPageNumbers(activePage, pageCount);
  const detailRecordIndex = detailRecord
    ? records.findIndex((record) => record.id === detailRecord.id)
    : -1;
  const detailBuiltIns = detailRecord
    ? getBuiltinRecordValues(detailRecord, formName, formType === "workflow")
    : null;

  function openDetail(record: FormRecord, editing = false) {
    setDetailRecord(record);
    setIsDetailEditing(editing);
    setDetailTab("comments");
    setIsDetailFullscreen(false);
  }

  useEffect(() => {
    if (!initialRecordId || autoOpenedRecordIdRef.current === initialRecordId) return;
    const record = records.find((item) => item.id === initialRecordId);
    if (!record) return;
    autoOpenedRecordIdRef.current = initialRecordId;
    const timer = window.setTimeout(() => openDetail(record), 0);
    return () => window.clearTimeout(timer);
  }, [initialRecordId, records]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDetailContentReady(Boolean(detailRecord));
    });
    return () => cancelAnimationFrame(frame);
  }, [detailRecord, isDetailEditing]);

  const handleDetailFormSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (!isDetailEditing || !detailRecord) return;
    const updated = await onUpdateRecord(detailRecord.id, values);
    if (updated) {
      setDetailRecord(null);
      setIsDetailEditing(false);
    }
  }, [detailRecord, isDetailEditing, onUpdateRecord]);

  function showAdjacentRecord(direction: -1 | 1) {
    const nextRecord = records[detailRecordIndex + direction];
    if (nextRecord) openDetail(nextRecord);
  }

  async function copyDetailRecord() {
    if (!detailRecord) return;
    try {
      await copyText(JSON.stringify(detailRecord.data, null, 2));
      toast.success("记录数据已复制");
    } catch {
      toast.danger("当前浏览器不支持复制，请手动选择文本");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
        正在加载数据...
      </div>
    );
  }

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Table className="flex min-h-0 flex-1 flex-col">
        <Table.ScrollContainer className="data-table-horizontal-scroll min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <Table.ResizableContainer onResizeEnd={handleColumnResizeEnd} className="min-w-full overflow-visible">
          <Table.Content
            aria-label="表单提交数据"
            selectionMode="multiple"
            selectedKeys={selectedRecordIds}
            onSelectionChange={handleSelectionChange}
            sortDescriptor={sortDescriptor}
            onSortChange={handleSortChange}
            className="data-table-content min-w-full text-left"
            style={{ "--data-table-minimum-width": `${tableMinimumWidth}px` } as CSSProperties}
          >
            <Table.Header>
              <Table.Column id="selection" defaultWidth={sequenceColumnWidth} minWidth={44} maxWidth={80} className="sticky left-0 z-30 bg-surface-secondary">
                <Checkbox slot="selection" aria-label="全选当前页" isSelected={allCurrentPageSelected} onChange={toggleCurrentPageSelection} className="justify-center">
                  <Checkbox.Content className="justify-center"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content>
                </Checkbox>
              </Table.Column>
              {tableColumns.map((column, tableIndex) => {
                const { field, index } = column;
                const minWidth = 24;
                const maxWidth = column.kind === "field" ? 320 : builtInColumnMaxWidths[index];
                const defaultWidth = savedColumnWidths[field.id] ?? (column.kind === "field" ? businessColumnWidths[index] : builtInColumnWidths[index]);
                return (
                  <Table.Column key={field.id} id={field.id} isRowHeader={tableIndex === 0} allowsSorting={sortableFieldIds.includes(field.id)} defaultWidth={defaultWidth} minWidth={minWidth} maxWidth={maxWidth} style={frozenColumnOffsets.has(field.id) ? { left: frozenColumnOffsets.get(field.id) } : undefined} className={frozenColumnOffsets.has(field.id) ? "relative sticky z-20 bg-surface-secondary shadow-[4px_0_8px_-8px_var(--color-text-secondary)]" : "relative"}>
                    <div className="flex min-w-0 items-center gap-1"><span className="truncate">{field.label}</span>{sortableFieldIds.includes(field.id) ? <ArrowUpArrowDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)]" /> : null}</div>
                    <Table.ColumnResizer aria-label={`调整${field.label}列宽`} onPointerDown={() => { resizingColumnIdRef.current = field.id; }} className="absolute inset-y-2 right-0 z-10 w-2 cursor-col-resize before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-[var(--color-border)] hover:before:bg-[var(--color-primary)] data-[resizing]:before:bg-[var(--color-primary)]" />
                  </Table.Column>
                );
              })}
              <Table.Column id="actions" isRowHeader={tableColumns.length === 0} defaultWidth={180} minWidth={180} className="sticky right-0 z-30 bg-surface-secondary shadow-[-4px_0_8px_-8px_var(--color-text-secondary)]">操作</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <div className="flex min-h-64 flex-col items-center justify-center px-4 py-12 text-center"><div className="text-base font-medium text-[var(--color-text-primary)]">暂无数据</div><div className="mt-2 text-sm text-[var(--color-text-secondary)]">当前表单还没有提交记录，可以先通过“新增”填写一条数据。</div></div>}>
              <Table.Collection items={tableRows}>
                {(record) => (
                  <Table.Row key={record.id} id={record.id} className="group">
                    <Table.Cell className="sticky left-0 z-20 bg-surface text-center">
                      <span className={selectedRecordIds.has(record.id) ? "opacity-0" : "transition-opacity group-hover:opacity-0"}>{record.rowNumber}</span>
                      <Checkbox
                        slot="selection"
                        aria-label={`选择第 ${record.rowNumber} 行`}
                        className={[
                          "absolute inset-0 flex items-center justify-center transition-opacity",
                          selectedRecordIds.has(record.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        ].join(" ")}
                      >
                        <Checkbox.Content className="flex h-full w-full items-center justify-center"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content>
                      </Checkbox>
                    </Table.Cell>
                    {tableColumns.map((column) => {
                      const { field } = column;
                      if (column.kind === "builtin") {
                        return <Table.Cell key={field.id} style={frozenColumnOffsets.has(field.id) ? { left: frozenColumnOffsets.get(field.id) } : undefined} className={frozenColumnOffsets.has(field.id) ? "sticky z-10 bg-surface shadow-[4px_0_8px_-8px_var(--color-text-secondary)]" : undefined}><span className="block truncate" title={record.displayValues.builtIns[field.id]}>{record.displayValues.builtIns[field.id]}</span></Table.Cell>;
                      }
                      const schemaField = field as SchemaField;
                      const relatedRecordId = getAssociationRecordId(schemaField, record.data[schemaField.id]);
                      const association = schemaField.props?.associationFormId
                        ? associationForms.get(schemaField.props.associationFormId)
                        : undefined;
                      const relatedRecord = relatedRecordId ? association?.records.get(relatedRecordId) : undefined;
                      const displayValue = record.displayValues.fields[schemaField.id];

                      return (
                        <Table.Cell key={schemaField.id} style={frozenColumnOffsets.has(schemaField.id) ? { left: frozenColumnOffsets.get(schemaField.id) } : undefined} className={frozenColumnOffsets.has(schemaField.id) ? "sticky z-10 bg-surface shadow-[4px_0_8px_-8px_var(--color-text-secondary)]" : undefined}>
                          {schemaField.type === "associationFormField" && relatedRecord && association ? (
                            <HeroLink
                              onPress={() => setAssociationDetail({ field: schemaField, record: relatedRecord, schema: association.schema })}
                              className="block cursor-pointer truncate text-sm text-[var(--color-primary)] hover:underline"
                            >
                              {displayValue}
                            </HeroLink>
                          ) : (
                            <span className="block truncate" title={displayValue}>{displayValue}</span>
                          )}
                        </Table.Cell>
                      );
                    })}
                    <Table.Cell className="sticky right-0 z-20 bg-surface shadow-[-4px_0_8px_-8px_var(--color-text-secondary)]">
                      <div className="flex w-max items-center gap-1.5">
                        <Button type="button" variant="ghost" className="h-8 gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-text-primary)]" onClick={() => openDetail(record)}><Eye className="h-3.5 w-3.5" />查看</Button>
                        {formType === "workflow" ? <Button type="button" variant="ghost" className="h-8 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-primary)]" isDisabled={submitting || record.data.workflowApprovalStatus !== "saved"} onClick={() => void onWorkflowAction(record, "submit")}>提交</Button> : null}
                        {formType === "workflow" ? <Button type="button" variant="ghost" className="h-8 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-warning)]" isDisabled={submitting || record.data.workflowApprovalStatus !== "approved"} onClick={() => void onWorkflowAction(record, "reverse")}>反审</Button> : null}
                        {formType === "workflow" ? <Button type="button" variant="ghost" className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-text-secondary)]" isDisabled={submitting || record.data.workflowInstanceStatus !== "running"} onClick={() => { setPauseTarget(record); setPauseReason(""); }}>暂停</Button> : null}
                        {formType === "workflow" ? <Button type="button" variant="ghost" className="h-8 rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-primary)]" isDisabled={submitting || record.data.workflowInstanceStatus !== "paused"} onClick={() => void onWorkflowAction(record, "resume")}>恢复</Button> : null}
                        {canDeleteRecord ? <Button type="button" variant="ghost" className="h-8 gap-1 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-danger)]" isDisabled={deletingRecordId === record.id} onClick={() => setDeleteRecordTarget(record)}><TrashBin className="h-3.5 w-3.5" />{deletingRecordId === record.id ? "删除中..." : "删除"}</Button> : null}
                        <Button isIconOnly type="button" variant="ghost" aria-label="复制记录数据" className="h-8 w-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]" onPress={() => void copyText(JSON.stringify(record.data, null, 2)).then(() => toast.success("记录数据已复制")).catch(() => toast.danger("当前浏览器不支持复制，请手动选择文本"))}><Copy className="h-3.5 w-3.5" /></Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Collection>
            </Table.Body>
          </Table.Content>
          </Table.ResizableContainer>
        </Table.ScrollContainer>
        <Table.Footer className="flex shrink-0 flex-nowrap items-center justify-between gap-4 overflow-x-auto">
        <Pagination.Summary className="shrink-0 whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
          共 {records.length} 条数据，当前显示 {records.length ? pageStart + 1 : 0}-{Math.min(pageStart + pageSize, records.length)} 条
        </Pagination.Summary>
        <Select
          aria-label="每页显示条数"
          className="w-28 shrink-0"
          selectedKey={String(pageSize)}
          onSelectionChange={(key) => {
            setPageSize(Number(key));
            setPage(1);
          }}
        >
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover>
            <ListBox>
              {pageSizeOptions.map((option) => <ListBox.Item key={option} id={String(option)} textValue={`每页 ${option} 条`}>每页 {option} 条</ListBox.Item>)}
            </ListBox>
          </Select.Popover>
        </Select>
        <Pagination size="sm" aria-label="数据分页" className="shrink-0">
          <Pagination.Content>
            <Pagination.Item><Pagination.Previous isDisabled={activePage === 1} onPress={() => setPage((current) => Math.max(1, current - 1))}>上一页</Pagination.Previous></Pagination.Item>
            {paginationPages.map((pageNumber, index) => pageNumber === "ellipsis" ? <Pagination.Item key={`ellipsis-${index}`}><Pagination.Ellipsis /></Pagination.Item> : <Pagination.Item key={pageNumber}><Pagination.Link isActive={activePage === pageNumber} onPress={() => setPage(pageNumber)}>{pageNumber}</Pagination.Link></Pagination.Item>)}
            <Pagination.Item><Pagination.Next isDisabled={activePage === pageCount} onPress={() => setPage((current) => Math.min(pageCount, current + 1))}>下一页</Pagination.Next></Pagination.Item>
          </Pagination.Content>
        </Pagination>
        </Table.Footer>
      </Table>
    </div>
    <Drawer
      isOpen={detailRecord !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setDetailRecord(null);
          setIsDetailEditing(false);
          setIsDetailFullscreen(false);
        }
      }}
    >
      <Drawer.Backdrop className="theme-modal-backdrop record-detail-backdrop" isDismissable>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="flex h-[100dvh] w-[90vw] max-w-[90vw] flex-col overflow-hidden bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Drawer.Header className="flex-col items-stretch gap-4 border-b border-[var(--color-border)] px-6 py-4">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="min-w-0">
                  <Drawer.Heading className="truncate text-lg font-semibold">{isDetailEditing ? "编辑数据" : detailBuiltIns?.instanceTitle ?? formName}</Drawer.Heading>
                  <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{formName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button isIconOnly variant="ghost" aria-label={isDetailFullscreen ? "退出全屏" : "全屏查看"} className="h-8 w-8" onPress={() => setIsDetailFullscreen((current) => !current)}><ArrowsExpand className="h-4 w-4" /></Button>
                  {detailRecordIndex > 0 ? <Button isIconOnly variant="ghost" aria-label="上一条数据" className="h-8 w-8" onPress={() => showAdjacentRecord(-1)}><ArrowChevronLeft className="h-4 w-4" /></Button> : <Button isIconOnly variant="ghost" aria-label="上一条数据" className="h-8 w-8" isDisabled><ArrowChevronLeft className="h-4 w-4" /></Button>}
                  {detailRecordIndex >= 0 && detailRecordIndex < records.length - 1 ? <Button isIconOnly variant="ghost" aria-label="下一条数据" className="h-8 w-8" onPress={() => showAdjacentRecord(1)}><ArrowChevronRight className="h-4 w-4" /></Button> : <Button isIconOnly variant="ghost" aria-label="下一条数据" className="h-8 w-8" isDisabled><ArrowChevronRight className="h-4 w-4" /></Button>}
                  <Button isIconOnly variant="ghost" aria-label="复制该数据" className="h-8 w-8" onPress={() => void copyDetailRecord()}><Copy className="h-4 w-4" /></Button>
                  <Dropdown><Dropdown.Trigger aria-label="更多详情操作" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)]"><Ellipsis className="h-4 w-4" /></Dropdown.Trigger><Dropdown.Popover><Dropdown.Menu aria-label="更多详情操作"><Dropdown.Item id="copy-json" onAction={() => void copyDetailRecord()}>复制 JSON</Dropdown.Item><Dropdown.Item id="record-id" isDisabled>记录 ID：{detailRecord?.id ?? "-"}</Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown>
                  <Drawer.CloseTrigger aria-label="关闭详情"><Xmark className="h-4 w-4" /></Drawer.CloseTrigger>
                </div>
              </div>
              {detailBuiltIns ? <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--color-border)] pt-4 text-sm md:grid-cols-4"><DetailBuiltIn label="提交时间" value={detailBuiltIns.createdAt} /><DetailBuiltIn label="发起人" value={detailBuiltIns.submitter} /><DetailBuiltIn label="发起人组织" value={detailBuiltIns.submitterOrganization} /><DetailBuiltIn label="实例 ID" value={detailBuiltIns.instanceId} /></div> : null}
            </Drawer.Header>
            <Drawer.Body className="min-h-0 flex-1 overflow-y-auto bg-[var(--designer-surface-soft)] p-5">
              {detailRecord && isDetailContentReady ? (
                <RuntimeFormSurface><RuntimeFormPanel
                  key={`${detailRecord.id}-${isDetailEditing ? "edit" : "view"}`}
                  formId={`record-detail-${detailRecord.id}`}
                  schema={schema}
                  initialValues={detailRecord.data}
                  isReadOnly={!isDetailEditing}
                  showSubmitButton={false}
                  submitLabel="保存修改"
                  submitting={submitting}
                  urlParams={urlParams}
                  onSubmit={handleDetailFormSubmit}
                /></RuntimeFormSurface>
              ) : detailRecord ? <div className="min-h-64 animate-pulse rounded-lg bg-[var(--color-bg-subtle)]" /> : null}
              {detailRecord && !isDetailEditing ? <DetailAuxiliaryPanel activeTab={detailTab} record={detailRecord} onTabChange={setDetailTab} /> : null}
            </Drawer.Body>
            <Drawer.Footer className="flex shrink-0 justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4">
              {isDetailEditing ? (
                <Button variant="ghost" isDisabled={submitting} onPress={() => setIsDetailEditing(false)}>取消编辑</Button>
              ) : null}
              {canDeleteRecord ? <Button
                variant="ghost"
                className="border border-[var(--color-danger)]/30 text-[var(--color-danger)]"
                isDisabled={!detailRecord || deletingRecordId === detailRecord?.id}
                onPress={() => detailRecord && setDeleteRecordTarget(detailRecord)}
              >
                {deletingRecordId === detailRecord?.id ? "删除中..." : "删除"}
              </Button> : null}
              {canEditRecord ? <Button
                isDisabled={!detailRecord || submitting}
                onPress={() => {
                  if (!detailRecord) return;
                  if (!isDetailEditing) {
                    setIsDetailEditing(true);
                  } else {
                    const form = document.getElementById(`record-detail-${detailRecord.id}`) as HTMLFormElement | null;
                    form?.requestSubmit();
                  }
                }}
              >
                {isDetailEditing ? (submitting ? "保存中..." : "保存") : "编辑"}
              </Button> : null}
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
    <Modal
      isOpen={associationDetail !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) setAssociationDetail(null);
      }}
    >
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="cover">
          <Modal.Dialog className="flex h-[min(860px,88vh)] w-[min(1180px,94vw)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Modal.Header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
              <div className="min-w-0">
                <Modal.Heading className="truncate text-lg font-semibold">
                  {associationDetail ? getAssociationPrimaryValue(associationDetail.field, associationDetail.record) : "关联数据"}
                </Modal.Heading>
                <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                  {associationDetail?.schema.formName ?? "关联表单"}
                </p>
              </div>
              <Modal.CloseTrigger aria-label="关闭关联数据详情"><Xmark className="h-4 w-4" /></Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {associationDetail ? (
                <RuntimeFormSurface><RuntimeFormPanel
                  key={associationDetail.record.id}
                  formId={`association-record-${associationDetail.record.id}`}
                  schema={associationDetail.schema}
                  initialValues={associationDetail.record.data}
                  isReadOnly
                  showSubmitButton={false}
                  submitLabel=""
                  submitting={false}
                  urlParams={urlParams}
                  onSubmit={async () => {}}
                /></RuntimeFormSurface>
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
    <Modal isOpen={pauseTarget !== null} onOpenChange={(open) => { if (!open) setPauseTarget(null); }}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable={!submitting}>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="theme-menu-surface rounded-2xl shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4"><Modal.Heading>暂停流程</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header>
            <Modal.Body className="space-y-3 px-5 py-4"><TextArea aria-label="暂停原因" value={pauseReason} onChange={(event) => setPauseReason(event.currentTarget.value)} placeholder="填写暂停原因（可选）" /></Modal.Body>
            <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3"><Button variant="ghost" isDisabled={submitting} onPress={() => setPauseTarget(null)}>取消</Button><Button isDisabled={submitting} onPress={() => { const target = pauseTarget; if (!target) return; void onWorkflowAction(target, "pause", pauseReason.trim() || undefined).then((success) => { if (success) setPauseTarget(null); }); }}>确认暂停</Button></Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
    <AlertDialog
      isOpen={deleteRecordTarget !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen && deletingRecordId === null) setDeleteRecordTarget(null);
      }}
    >
      <AlertDialog.Backdrop className="theme-modal-backdrop">
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog className="theme-menu-surface rounded-xl shadow-[var(--shadow-dialog)]">
            <AlertDialog.Header className="border-b border-[var(--color-border)] px-5 py-4">
              <AlertDialog.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                删除数据
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">
              确认删除这条数据吗？删除后无法恢复。
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
              <Button variant="ghost" isDisabled={deletingRecordId !== null} onPress={() => setDeleteRecordTarget(null)}>
                取消
              </Button>
              <Button
                isDisabled={!deleteRecordTarget || deletingRecordId !== null}
                className="bg-[var(--color-danger)] text-[var(--color-text-on-primary)]"
                onPress={async () => {
                  if (!deleteRecordTarget) return;
                  const deletedRecord = deleteRecordTarget;
                  const deleted = await onDeleteRecord(deletedRecord.id);
                  if (!deleted) return;
                  setDeleteRecordTarget(null);
                  if (detailRecord?.id === deletedRecord.id) {
                    setDetailRecord(null);
                    setIsDetailEditing(false);
                  }
                }}
              >
                {deletingRecordId ? "删除中..." : "确认删除"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
    </>
  );
}
