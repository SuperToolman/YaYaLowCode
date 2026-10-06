"use client";
import { notify } from "@lib/notify";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Dropdown,
  Link as HeroLink,
  ListBox,
  Select,
  TextArea,
  type SortDescriptor,
} from "@heroui/react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Drawer } from "@heroui/react/drawer";
import { Modal } from "@heroui/react/modal";
import { Pagination } from "@heroui/react/pagination";
import {
  ArrowChevronLeft,
  ArrowChevronRight,
  ArrowsExpand,
  Copy,
  Ellipsis,
  Xmark,
} from "@gravity-ui/icons";
import {
  RuntimeFormRenderer,
  RuntimeFormSurface,
  type RuntimeFormSchema,
  type RuntimeSchemaField,
} from "@/features/form-runtime/components";
import { DetailAuxiliaryPanel } from "./RecordDetailAuxiliaryPanel";
import {
  DetailBuiltIn,
  getPaginationPageNumbers,
} from "./RecordsTablePrimitives";
import {
  estimateTableColumnWidth,
  getAssociationPrimaryValue,
  getAssociationRecordId,
  getBuiltinRecordValues,
  getTableFieldDisplayValue,
  workflowApprovalStatusLabel,
  workflowInstanceStatusLabel,
} from "../form-record-utils";
import type { ViewConfig, ViewSortRule } from "../model/use-form-views";
import type { FormRecord } from "@/features/records/types";
import type { AssociationFormData } from "@/features/records/types";
import { useAssociationFormsQuery } from "@/features/records/queries";
import { MySurface } from "@shared/ui/MySurface";
import {
  MyTable,
  MyTableCheckbox,
  type MyTableColumnMeta,
} from "@components/my-fields/MyTable";
import { RecordRowActions } from "./RecordRowActions";
import styles from "./RecordsTable.module.css";

type SchemaField = RuntimeSchemaField;

type TableSelectionContextValue = {
  selectedIds: Set<string>;
  pageIds: string[];
  onRowChange: (recordId: string, selected: boolean) => void;
  onPageChange: (selectedPageIds: Set<string>) => void;
};

const TableSelectionContext = createContext<TableSelectionContextValue | null>(null);

function SelectionHeader() {
  const selection = useContext(TableSelectionContext);
  if (!selection) return null;
  const allSelected = selection.pageIds.length > 0 &&
    selection.pageIds.every((id) => selection.selectedIds.has(id));
  return (
    <MyTableCheckbox
      ariaLabel="全选当前页"
      isSelected={allSelected}
      onChange={(selected) => selection.onPageChange(new Set(selected ? selection.pageIds : []))}
    />
  );
}

function SelectionCell({ recordId, rowNumber }: { recordId: string; rowNumber: number }) {
  const selection = useContext(TableSelectionContext);
  if (!selection) return null;
  const isSelected = selection.selectedIds.has(recordId);
  return (
    <>
      <span className={`!text-[12px] ${isSelected ? "opacity-0" : "transition-opacity group-hover:opacity-0"}`}>{rowNumber}</span>
      <span className={`absolute inset-0 flex items-center justify-center transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <MyTableCheckbox ariaLabel={`选择第 ${rowNumber} 行`} isSelected={isSelected} onChange={(selected) => selection.onRowChange(recordId, selected)} />
      </span>
    </>
  );
}

type FormSchema = RuntimeFormSchema;
type RecordTableRow = FormRecord & {
  rowNumber: number;
  displayValues: {
    fields: Record<string, string>;
    builtIns: Record<string, string>;
  };
};
type BuiltInTableColumn = {
  kind: "builtin";
  field: { id: string; label: string };
  index: number;
};
type CombinedInstanceTableColumn = {
  kind: "combinedInstance";
  field: { id: "instanceId"; label: "实例标题" };
  index: number;
};
type CombinedSubmitterTableColumn = {
  kind: "combinedSubmitter";
  field: { id: "submitter"; label: "提交人&组织" };
  index: number;
};
type RecordTableColumn =
  | { kind: "field"; field: SchemaField; index: number }
  | BuiltInTableColumn
  | CombinedInstanceTableColumn
  | CombinedSubmitterTableColumn;
type TableAssociationFormData = AssociationFormData<FormSchema>;
type AssociationDetail = {
  field: SchemaField;
  record: FormRecord;
  schema: FormSchema;
};

const WORKFLOW_DELETE_WARNING_APPROVAL_STATUSES = new Set([
  "reviewing",
  "approved",
  "rejected",
]);
const WORKFLOW_DELETE_WARNING_INSTANCE_STATUSES = new Set([
  "running",
  "paused",
  "completed",
  "failed",
]);

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

function getDynamicColumnWidth(
  label: string,
  values: string[],
  sortable: boolean,
  maxWidth: number,
) {
  const titleWidth =
    estimateTableColumnWidth([label], 24, maxWidth) + (sortable ? 20 : 0);
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
  submitting,
  onDeleteRecord,
  onUpdateRecord,
  onWorkflowAction,
  onCompleteExecutionTask,
  canEditRecord,
  canDeleteRecord,
  urlParams,
  onRecordSelectionChange,
  onPageSelectionChange,
  onViewConfigChange,
  initialRecordId,
  initialTaskId,
  pagination,
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
  submitting: boolean;
  onDeleteRecord: (recordId: string) => Promise<boolean>;
  onUpdateRecord: (
    recordId: string,
    values: Record<string, unknown>,
  ) => Promise<boolean>;
  onWorkflowAction: (
    record: FormRecord,
    action: "submit" | "reverse" | "pause" | "resume",
    reason?: string,
  ) => Promise<boolean>;
  onCompleteExecutionTask: (
    taskId: string,
    changes: Record<string, unknown>,
  ) => Promise<boolean>;
  canEditRecord: boolean;
  canDeleteRecord: boolean;
  urlParams: Record<string, string>;
  onRecordSelectionChange: (recordId: string, selected: boolean) => void;
  onPageSelectionChange: (pageIds: string[], selectedPageIds: Set<string>) => void;
  onViewConfigChange: (
    patch: Partial<Pick<ViewConfig, "columnOrder" | "columnWidths" | "sorts">>,
  ) => void;
  initialRecordId?: string;
  initialTaskId?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
}) {
  const pageSizeOptions = [10, 20, 30, 40, 50];
  const columns = fields;
  const tableColumns = useMemo(() => {
    const businessColumns = new Map(
      columns.map((field, index) => [
        field.id,
        { kind: "field" as const, field, index },
      ]),
    );
    const builtInColumns = new Map(
      builtinFields.map((field, index) => [
        field.id,
        { kind: "builtin" as const, field, index },
      ]),
    );
    const ordered: RecordTableColumn[] = [];

    columnOrder.forEach((id) => {
      const column = businessColumns.get(id) ?? builtInColumns.get(id);
      if (!column) return;
      ordered.push(column);
      businessColumns.delete(id);
      builtInColumns.delete(id);
    });

    const allColumns = [
      ...ordered,
      ...businessColumns.values(),
      ...builtInColumns.values(),
    ];
    const instanceTitleIndex = allColumns.findIndex(
      (column) =>
        column.kind === "builtin" && column.field.id === "instanceTitle",
    );
    const instanceIdIndex = allColumns.findIndex(
      (column) => column.kind === "builtin" && column.field.id === "instanceId",
    );
    const withCombinedInstance =
      instanceTitleIndex < 0 || instanceIdIndex < 0
        ? allColumns
        : allColumns
            .filter(
              (column) =>
                !(
                  column.kind === "builtin" &&
                  (column.field.id === "instanceTitle" ||
                    column.field.id === "instanceId")
                ),
            )
            .toSpliced(Math.min(instanceTitleIndex, instanceIdIndex), 0, {
              kind: "combinedInstance",
              field: { id: "instanceId", label: "实例标题" },
              index: instanceTitleIndex,
            });
    const submitterIndex = withCombinedInstance.findIndex(
      (column) => column.kind === "builtin" && column.field.id === "submitter",
    );
    const organizationIndex = withCombinedInstance.findIndex(
      (column) =>
        column.kind === "builtin" &&
        column.field.id === "submitterOrganization",
    );
    if (submitterIndex < 0 || organizationIndex < 0)
      return withCombinedInstance;

    return withCombinedInstance
      .filter(
        (column) =>
          !(
            column.kind === "builtin" &&
            (column.field.id === "submitter" ||
              column.field.id === "submitterOrganization")
          ),
      )
      .toSpliced(Math.min(submitterIndex, organizationIndex), 0, {
        kind: "combinedSubmitter",
        field: { id: "submitter", label: "提交人&组织" },
        index: submitterIndex,
      });
  }, [builtinFields, columnOrder, columns]);
  const [detailRecord, setDetailRecord] = useState<FormRecord | null>(null);
  const autoOpenedRecordIdRef = useRef<string | null>(null);
  const [isDetailEditing, setIsDetailEditing] = useState(false);
  const detailSubmitModeRef = useRef<"save" | "complete">("save");
  const [detailTab, setDetailTab] = useState<"comments" | "history">(
    "comments",
  );
  const [pauseTarget, setPauseTarget] = useState<FormRecord | null>(null);
  const [pauseReason, setPauseReason] = useState("");
  const [isDetailFullscreen, setIsDetailFullscreen] = useState(false);
  const [deleteRecordTarget, setDeleteRecordTarget] =
    useState<FormRecord | null>(null);
  const workflowDeleteWarning =
    formType === "workflow" &&
    deleteRecordTarget !== null &&
    (WORKFLOW_DELETE_WARNING_APPROVAL_STATUSES.has(
      String(deleteRecordTarget.data.workflowApprovalStatus ?? ""),
    ) ||
      WORKFLOW_DELETE_WARNING_INSTANCE_STATUSES.has(
        String(deleteRecordTarget.data.workflowInstanceStatus ?? ""),
      ));
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(20);
  const [isDetailContentReady, setIsDetailContentReady] = useState(false);
  const [associationDetail, setAssociationDetail] =
    useState<AssociationDetail | null>(null);
  const associationFormIds = useMemo(
    () => [
      ...new Set(
        columns
          .filter(
            (field) =>
              field.type === "associationFormField" &&
              field.props?.associationFormId,
          )
          .map((field) => field.props!.associationFormId!),
      ),
    ],
    [columns],
  );

  const associationForms = useAssociationFormsQuery(associationFormIds) as Map<
    string,
    TableAssociationFormData
  >;
  const recordDisplayValues = useMemo(() => {
    const values = new Map<
      string,
      {
        fields: Record<string, string>;
        builtIns: Record<string, string>;
      }
    >();

    records.forEach((record) => {
      values.set(record.id, {
        fields: Object.fromEntries(
          columns.map((field) => [
            field.id,
            getTableFieldDisplayValue(field, record, associationForms),
          ]),
        ),
        builtIns: getBuiltinRecordValues(
          record,
          formName,
          formType === "workflow",
        ),
      });
    });

    return values;
  }, [associationForms, columns, formName, formType, records]);
  const businessColumnWidths = useMemo(
    () =>
      columns.map((field) =>
        getDynamicColumnWidth(
          field.label,
          records.map(
            (record) =>
              recordDisplayValues.get(record.id)?.fields[field.id] ?? "",
          ),
          sortableFieldIds.includes(field.id),
          320,
        ),
      ),
    [columns, recordDisplayValues, records, sortableFieldIds],
  );
  const builtInColumnMaxWidths = useMemo(
    () =>
      builtinFields.map((field) => (field.id === "instanceTitle" ? 360 : 260)),
    [builtinFields],
  );
  const builtInColumnWidths = useMemo(
    () =>
      builtinFields.map((field, index) =>
        getDynamicColumnWidth(
          field.label,
          records.map(
            (record) =>
              recordDisplayValues.get(record.id)?.builtIns[field.id] ?? "",
          ),
          sortableFieldIds.includes(field.id),
          builtInColumnMaxWidths[index],
        ),
      ),
    [
      builtInColumnMaxWidths,
      builtinFields,
      recordDisplayValues,
      records,
      sortableFieldIds,
    ],
  );
  const pageSize = pagination?.pageSize ?? localPageSize;
  const totalRecords = pagination?.total ?? records.length;
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize));
  const activePage = Math.min(pagination?.page ?? localPage, pageCount);
  const pageStart = (activePage - 1) * pageSize;
  const pageRecords = useMemo(
    () => pagination ? records : records.slice(pageStart, pageStart + pageSize),
    [pagination, records, pageStart, pageSize],
  );
  const pageIds = useMemo(() => pageRecords.map((record) => record.id), [pageRecords]);
  const tableRows = useMemo<RecordTableRow[]>(
    () =>
      pageRecords.map((record, index) => ({
        ...record,
        rowNumber: pageStart + index + 1,
        displayValues: recordDisplayValues.get(record.id)!,
      })),
    [pageRecords, pageStart, recordDisplayValues],
  );
  const activeSort = sorts[0];
  const sortDescriptor = useMemo<SortDescriptor | undefined>(
    () =>
      activeSort
        ? {
            column: activeSort.fieldId,
            direction:
              activeSort.direction === "asc" ? "ascending" : "descending",
          }
        : undefined,
    [activeSort],
  );
  const handleSortChange = useCallback(
    (descriptor: SortDescriptor) => {
      if (!descriptor) {
        onViewConfigChange({ sorts: [] });
        return;
      }
      const columnId = String(descriptor.column);
      onViewConfigChange({
        sorts: [
          {
            id: `header-sort-${columnId}`,
            fieldId: columnId,
            direction: descriptor.direction === "ascending" ? "asc" : "desc",
          },
          ...sorts.filter((rule) => rule.fieldId !== columnId),
        ],
      });
    },
    [onViewConfigChange, sorts],
  );
  const paginationPages = getPaginationPageNumbers(activePage, pageCount);
  const setPage = (nextPage: number) => {
    if (pagination) pagination.onPageChange(nextPage);
    else setLocalPage(nextPage);
  };
  const setPageSize = (nextPageSize: number) => {
    if (pagination) pagination.onPageSizeChange(nextPageSize);
    else setLocalPageSize(nextPageSize);
  };
  const detailRecordIndex = detailRecord
    ? records.findIndex((record) => record.id === detailRecord.id)
    : -1;
  const detailBuiltIns = detailRecord
    ? getBuiltinRecordValues(detailRecord, formName, formType === "workflow")
    : null;
  const workflowActionRef = useRef(onWorkflowAction);
  workflowActionRef.current = onWorkflowAction;

  const myTableColumns = useMemo<ColumnDef<RecordTableRow, unknown>[]>(() => {
    const selectionColumn: ColumnDef<RecordTableRow, unknown> = {
      id: "selection",
      size: 44,
      minSize: 44,
      maxSize: 44,
      meta: {
        pin: "left",
        fixedWidth: 44,
        headerClassName: "text-center",
        cellClassName: "text-center",
      } satisfies MyTableColumnMeta,
      header: () => <div className="flex items-center justify-center"><SelectionHeader /></div>,
      cell: ({ row }) => <SelectionCell recordId={row.original.id} rowNumber={row.original.rowNumber} />,
    };
    const dataColumns = tableColumns.map(
      (column): ColumnDef<RecordTableRow, unknown> => {
        const { field, index } = column;
        const id =
          column.kind === "combinedInstance"
            ? "instanceId"
            : column.kind === "combinedSubmitter"
              ? "submitter"
              : field.id;
        const defaultWidth =
          savedColumnWidths[id] ??
          (column.kind === "field"
            ? businessColumnWidths[index]
            : builtInColumnWidths[index]);
        const meta: MyTableColumnMeta = {
          pin: frozenFieldIds.includes(id) ? "left" : undefined,
        };
        return {
          id,
          accessorFn: (record) =>
            column.kind === "combinedInstance"
              ? (record.displayValues.builtIns.instanceTitle ?? "")
              : column.kind === "combinedSubmitter"
                ? (record.displayValues.builtIns.submitter ?? "")
              : (record.displayValues.fields[id] ??
                record.displayValues.builtIns[id] ??
                ""),
          header: field.label,
          size: defaultWidth,
          minSize: 80,
          enableSorting: sortableFieldIds.includes(id),
          meta,
          cell: ({ row }) => {
            const record = row.original;
            if (column.kind === "combinedInstance")
              return (
                <div
                  className="min-w-0 leading-tight"
                  title={`${record.displayValues.builtIns.instanceTitle} (${record.displayValues.builtIns.instanceId})`}
                >
                  <span className="block truncate !text-xs">
                    {record.displayValues.builtIns.instanceTitle}
                  </span>
                  <span className="mt-0.5 block truncate !text-[10px] text-[var(--color-text-secondary)]">
                    {record.displayValues.builtIns.instanceId}
                  </span>
                </div>
              );
            if (column.kind === "combinedSubmitter")
              return (
                <div
                  className="min-w-0 leading-tight"
                  title={`${record.displayValues.builtIns.submitter} (${record.displayValues.builtIns.submitterOrganization})`}
                >
                  <span className="block truncate !text-xs">
                    {record.displayValues.builtIns.submitter}
                  </span>
                  <span className="mt-0.5 block truncate !text-[10px] text-[var(--color-text-secondary)]">
                    {record.displayValues.builtIns.submitterOrganization}
                  </span>
                </div>
              );
            if (column.kind === "builtin")
              return (
                <span
                  className="block truncate"
                  title={record.displayValues.builtIns[id]}
                >
                  {record.displayValues.builtIns[id]}
                </span>
              );
            const schemaField = field as SchemaField;
            const relatedRecordId = getAssociationRecordId(
              schemaField,
              record.data[schemaField.id],
            );
            const association = schemaField.props?.associationFormId
              ? associationForms.get(schemaField.props.associationFormId)
              : undefined;
            const relatedRecord = relatedRecordId
              ? association?.records.get(relatedRecordId)
              : undefined;
            const displayValue = record.displayValues.fields[schemaField.id];
            return schemaField.type === "associationFormField" &&
              relatedRecord &&
              association ? (
              <HeroLink
                onPress={() =>
                  setAssociationDetail({
                    field: schemaField,
                    record: relatedRecord,
                    schema: association.schema,
                  })
                }
                className="block cursor-pointer truncate text-[var(--color-primary)] hover:underline"
              >
                {displayValue}
              </HeroLink>
            ) : (
              <span className="block truncate" title={displayValue}>
                {displayValue}
              </span>
            );
          },
        };
      },
    );
    const actionColumn: ColumnDef<RecordTableRow, unknown> = {
      id: "actions",
      header: "操作",
      size: 180,
      minSize: 180,
      meta: { pin: "right", fixedWidth: 180 },
      cell: ({ row }) => {
        const record = row.original;
        return (
          <RecordRowActions
            record={record}
            formType={formType}
            submitting={submitting}
            canDeleteRecord={canDeleteRecord}
            deletingRecordId={deletingRecordId}
            onOpenDetail={() => openDetail(record)}
            onWorkflowAction={(action) => void workflowActionRef.current(record, action)}
            onPause={() => {
              setPauseTarget(record);
              setPauseReason("");
            }}
            onDelete={() => setDeleteRecordTarget(record)}
            onCopy={() =>
              void copyText(JSON.stringify(record.data, null, 2))
                .then(() => notify.success("记录数据已复制"))
                .catch(() =>
                  notify.error("当前浏览器不支持复制，请手动选择文本"),
                )
            }
          />
        );
      },
    };
    return [selectionColumn, ...dataColumns, actionColumn];
  }, [
    associationForms,
    builtInColumnMaxWidths,
    builtInColumnWidths,
    businessColumnWidths,
    canDeleteRecord,
    deletingRecordId,
    formType,
    frozenFieldIds,
    savedColumnWidths,
    sortableFieldIds,
    submitting,
    tableColumns,
  ]);

  function openDetail(record: FormRecord, editing = false) {
    setDetailRecord(record);
    setIsDetailEditing(editing);
    detailSubmitModeRef.current = "save";
    setDetailTab("comments");
    setIsDetailFullscreen(false);
  }

  useEffect(() => {
    if (!initialRecordId || autoOpenedRecordIdRef.current === initialRecordId)
      return;
    const record = records.find((item) => item.id === initialRecordId);
    if (!record) return;
    autoOpenedRecordIdRef.current = initialRecordId;
    const timer = window.setTimeout(() => openDetail(record, Boolean(initialTaskId)), 0);
    return () => window.clearTimeout(timer);
  }, [initialRecordId, initialTaskId, records]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDetailContentReady(Boolean(detailRecord));
    });
    return () => cancelAnimationFrame(frame);
  }, [detailRecord, isDetailEditing]);

  const handleDetailFormSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      if (!isDetailEditing || !detailRecord) return;
      const completingTask = detailSubmitModeRef.current === "complete" && initialTaskId && detailRecord.id === initialRecordId;
      const updated = completingTask
        ? await onCompleteExecutionTask(
            initialTaskId,
            Object.fromEntries(Object.entries(values).filter(([key, value]) =>
              JSON.stringify(value) !== JSON.stringify(detailRecord.data[key]),
            )),
          )
        : await onUpdateRecord(detailRecord.id, values);
      if (updated) {
        if (!completingTask && initialTaskId && detailRecord.id === initialRecordId) {
          setDetailRecord({ ...detailRecord, data: { ...detailRecord.data, ...values } });
          return;
        }
        setDetailRecord(null);
        setIsDetailEditing(false);
      }
    },
    [detailRecord, initialRecordId, initialTaskId, isDetailEditing, onCompleteExecutionTask, onUpdateRecord],
  );

  function showAdjacentRecord(direction: -1 | 1) {
    const nextRecord = records[detailRecordIndex + direction];
    if (nextRecord) openDetail(nextRecord);
  }

  async function copyDetailRecord() {
    if (!detailRecord) return;
    try {
      await copyText(JSON.stringify(detailRecord.data, null, 2));
      notify.success("记录数据已复制");
    } catch {
      notify.error("当前浏览器不支持复制，请手动选择文本");
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <MySurface className="min-h-0 min-w-0 flex-1 overflow-hidden p-0">
          <TableSelectionContext.Provider
            value={{
              selectedIds: selectedRecordIds,
              pageIds,
              onRowChange: onRecordSelectionChange,
              onPageChange: (selectedPageIds) => onPageSelectionChange(pageIds, selectedPageIds),
            }}
          >
            <MyTable
            ariaLabel="表单提交数据"
            data={tableRows}
            columns={myTableColumns}
            getRowId={(record) => record.id}
            className="flex-1"
            sortDescriptor={sortDescriptor}
            onSortChange={handleSortChange}
            selectedRowIds={selectedRecordIds}
            onSelectedRowIdsChange={(nextSelectedIds) => onPageSelectionChange(pageIds, nextSelectedIds)}
            columnSizing={savedColumnWidths}
            onColumnSizingChange={(sizing) =>
              onViewConfigChange({ columnWidths: sizing })
            }
            emptyState={
              <div>
                <div className="text-base font-medium">暂无数据</div>
                <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  当前表单还没有提交记录，可以先通过“新增”填写一条数据。
                </div>
              </div>
            }
            />
          </TableSelectionContext.Provider>
        </MySurface>
        <MySurface className="shrink-0 min-w-0 overflow-hidden p-0">
          <div className="flex min-h-14 min-w-0 flex-nowrap items-center justify-between gap-4 overflow-hidden px-4 py-2">
            <Pagination.Summary className="shrink-0 whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
              共 {totalRecords} 条数据，当前显示{" "}
              {totalRecords ? pageStart + 1 : 0}-
              {Math.min(pageStart + pageRecords.length, totalRecords)} 条
            </Pagination.Summary>
            <div className="ml-auto flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-4">
              <Select
                aria-label="每页显示条数"
                className="w-28 shrink-0"
                selectedKey={String(pageSize)}
                onSelectionChange={(key) => {
                  setPageSize(Number(key));
                  setPage(1);
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {pageSizeOptions.map((option) => (
                      <ListBox.Item
                        key={option}
                        id={String(option)}
                        textValue={`每页 ${option} 条`}
                      >
                        每页 {option} 条
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Pagination
                size="sm"
                aria-label="数据分页"
                className="w-auto shrink-0 overflow-hidden"
              >
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={activePage === 1}
                      onPress={() => setPage(Math.max(1, activePage - 1))}
                    >
                      上一页
                    </Pagination.Previous>
                  </Pagination.Item>
                  {paginationPages.map((pageNumber, index) =>
                    pageNumber === "ellipsis" ? (
                      <Pagination.Item key={`ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={pageNumber}>
                        <Pagination.Link
                          isActive={activePage === pageNumber}
                          onPress={() => setPage(pageNumber)}
                          className={
                            activePage === pageNumber
                              ? "border border-[var(--color-primary)] bg-[var(--color-primary)] font-semibold !text-[var(--color-text-on-primary)] shadow-sm hover:bg-[var(--color-primary)]"
                              : "border border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]"
                          }
                        >
                          {pageNumber}
                        </Pagination.Link>
                      </Pagination.Item>
                    ),
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={activePage === pageCount}
                      onPress={() =>
                        setPage(Math.min(pageCount, activePage + 1))
                      }
                    >
                      下一页
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </div>
          </div>
        </MySurface>
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
        <Drawer.Backdrop
          className={`theme-modal-backdrop ${styles["records-table__detail-backdrop"]}`}
          isDismissable
        >
          <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-[100dvh] w-[100vw] max-w-[100vw] flex-col overflow-hidden bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)] sm:w-[60vw] sm:max-w-[60vw]">
              <Drawer.Header className="flex-col items-stretch gap-4 ">
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Drawer.Heading className="truncate text-lg font-semibold">
                      {isDetailEditing
                        ? "编辑数据"
                        : (detailBuiltIns?.instanceTitle ?? formName)}
                    </Drawer.Heading>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      isIconOnly
                      variant="ghost"
                      aria-label={isDetailFullscreen ? "退出全屏" : "全屏查看"}
                      className="h-8 w-8"
                      onPress={() =>
                        setIsDetailFullscreen((current) => !current)
                      }
                    >
                      <ArrowsExpand className="h-4 w-4" />
                    </Button>
                    {detailRecordIndex > 0 ? (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="上一条数据"
                        className="h-8 w-8"
                        onPress={() => showAdjacentRecord(-1)}
                      >
                        <ArrowChevronLeft className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="上一条数据"
                        className="h-8 w-8"
                        isDisabled
                      >
                        <ArrowChevronLeft className="h-4 w-4" />
                      </Button>
                    )}
                    {detailRecordIndex >= 0 &&
                    detailRecordIndex < records.length - 1 ? (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="下一条数据"
                        className="h-8 w-8"
                        onPress={() => showAdjacentRecord(1)}
                      >
                        <ArrowChevronRight className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="下一条数据"
                        className="h-8 w-8"
                        isDisabled
                      >
                        <ArrowChevronRight className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      isIconOnly
                      variant="ghost"
                      aria-label="复制该数据"
                      className="h-8 w-8"
                      onPress={() => void copyDetailRecord()}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Dropdown>
                      <Dropdown.Trigger
                        aria-label="更多详情操作"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)]"
                      >
                        <Ellipsis className="h-4 w-4" />
                      </Dropdown.Trigger>
                      <Dropdown.Popover>
                        <Dropdown.Menu aria-label="更多详情操作">
                          <Dropdown.Item
                            id="copy-json"
                            onAction={() => void copyDetailRecord()}
                          >
                            复制 JSON
                          </Dropdown.Item>
                          <Dropdown.Item id="record-id" isDisabled>
                            记录 ID：{detailRecord?.id ?? "-"}
                          </Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                    <Drawer.CloseTrigger aria-label="关闭详情">
                      <Xmark className="h-4 w-4" />
                    </Drawer.CloseTrigger>
                  </div>
                </div>
                {detailBuiltIns ? (
                  <div className="flex justify-between">
                    <DetailBuiltIn
                      label="提交时间"
                      value={detailBuiltIns.createdAt}
                    />
                    <DetailBuiltIn
                      label="发起人"
                      value={detailBuiltIns.submitter}
                    />
                    <DetailBuiltIn
                      label="发起人组织"
                      value={detailBuiltIns.submitterOrganization}
                    />
                    <DetailBuiltIn
                      label="实例 ID"
                      value={detailBuiltIns.instanceId}
                    />
                  </div>
                ) : null}
              </Drawer.Header>
              <Drawer.Body className="flex-1">
                {detailRecord && isDetailContentReady ? (
                  <RuntimeFormSurface>
                    <RuntimeFormPanel
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
                    />
                  </RuntimeFormSurface>
                ) : detailRecord ? (
                  <div className="min-h-64 animate-pulse rounded-lg bg-[var(--color-bg-subtle)]" />
                ) : null}
                {detailRecord && !isDetailEditing ? (
                  <DetailAuxiliaryPanel
                    activeTab={detailTab}
                    record={detailRecord}
                    onTabChange={setDetailTab}
                  />
                ) : null}
              </Drawer.Body>
              <Drawer.Footer>
                {isDetailEditing ? (
                  <Button
                    variant="ghost"
                    isDisabled={submitting}
                    onPress={() => setIsDetailEditing(false)}
                  >
                    取消编辑
                  </Button>
                ) : null}
                {canDeleteRecord ? (
                  <Button
                    variant="ghost"
                    className="border border-[var(--color-danger)]/30 text-[var(--color-danger)]"
                    isDisabled={
                      !detailRecord || deletingRecordId === detailRecord?.id
                    }
                    onPress={() =>
                      detailRecord && setDeleteRecordTarget(detailRecord)
                    }
                  >
                    {deletingRecordId === detailRecord?.id
                      ? "删除中..."
                      : "删除"}
                  </Button>
                ) : null}
                {canEditRecord ? (
                  <Button
                    isDisabled={!detailRecord || submitting}
                    onPress={() => {
                      if (!detailRecord) return;
                      if (!isDetailEditing) {
                        setIsDetailEditing(true);
                      } else {
                        detailSubmitModeRef.current = "save";
                        const form = document.getElementById(
                          `record-detail-${detailRecord.id}`,
                        ) as HTMLFormElement | null;
                        form?.requestSubmit();
                      }
                    }}
                  >
                    {isDetailEditing
                      ? submitting
                        ? "保存中..."
                        : "保存"
                      : "编辑"}
                  </Button>
                ) : null}
                {initialTaskId && detailRecord?.id === initialRecordId ? (
                  <Button
                    isDisabled={!detailRecord || submitting}
                    onPress={() => {
                      if (!detailRecord) return;
                      if (!isDetailEditing) {
                        setIsDetailEditing(true);
                        return;
                      }
                      detailSubmitModeRef.current = "complete";
                      const form = document.getElementById(`record-detail-${detailRecord.id}`) as HTMLFormElement | null;
                      form?.requestSubmit();
                    }}
                  >
                    {isDetailEditing ? "保存并完成" : "填写并完成"}
                  </Button>
                ) : null}
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
              <Modal.Header className="flex items-center justify-between ">
                <div className="min-w-0">
                  <Modal.Heading className="truncate text-lg font-semibold">
                    {associationDetail
                      ? getAssociationPrimaryValue(
                          associationDetail.field,
                          associationDetail.record,
                        )
                      : "关联数据"}
                  </Modal.Heading>
                  <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                    {associationDetail?.schema.formName ?? "关联表单"}
                  </p>
                </div>
                <Modal.CloseTrigger aria-label="关闭关联数据详情">
                  <Xmark className="h-4 w-4" />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
                {associationDetail ? (
                  <RuntimeFormSurface>
                    <RuntimeFormPanel
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
                    />
                  </RuntimeFormSurface>
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={pauseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPauseTarget(null);
        }}
      >
        <Modal.Backdrop
          className="theme-modal-backdrop"
          isDismissable={!submitting}
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="theme-menu-surface rounded-2xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)]">
                <Modal.Heading>暂停流程</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body className="space-y-3">
                <TextArea
                  aria-label="暂停原因"
                  value={pauseReason}
                  onChange={(event) =>
                    setPauseReason(event.currentTarget.value)
                  }
                  placeholder="填写暂停原因（可选）"
                />
              </Modal.Body>
              <Modal.Footer className="">
                <Button
                  variant="ghost"
                  isDisabled={submitting}
                  onPress={() => setPauseTarget(null)}
                >
                  取消
                </Button>
                <Button
                  isDisabled={submitting}
                  onPress={() => {
                    const target = pauseTarget;
                    if (!target) return;
                    void onWorkflowAction(
                      target,
                      "pause",
                      pauseReason.trim() || undefined,
                    ).then((success) => {
                      if (success) setPauseTarget(null);
                    });
                  }}
                >
                  确认暂停
                </Button>
              </Modal.Footer>
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
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  删除数据
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="">
                <p>确认删除这条数据吗？删除后无法恢复。</p>
                {workflowDeleteWarning ? (
                  <div className="mt-4 border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
                    <p className="font-medium">该流程记录已进入审批或实例生命周期。</p>
                    <p className="mt-1 text-[var(--color-text-secondary)]">
                      审批状态：{workflowApprovalStatusLabel(deleteRecordTarget?.data.workflowApprovalStatus)}；实例状态：{workflowInstanceStatusLabel(deleteRecordTarget?.data.workflowInstanceStatus)}。
                    </p>
                    <p className="mt-1 text-[var(--color-text-secondary)]">
                      删除后，业务数据会移入回收站，相关流程历史可能仍会保留。
                    </p>
                  </div>
                ) : null}
              </AlertDialog.Body>
              <AlertDialog.Footer className="">
                <Button
                  variant="ghost"
                  isDisabled={deletingRecordId !== null}
                  onPress={() => setDeleteRecordTarget(null)}
                >
                  取消
                </Button>
                <Button
                  isDisabled={!deleteRecordTarget || deletingRecordId !== null}
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
