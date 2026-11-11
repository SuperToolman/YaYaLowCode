"use client";

import { notifyRequestError } from "@/shared/lib/notify";
import { notify } from "@/shared/lib/notify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Link as HeroLink, ListBox, Select, type SortDescriptor } from "@heroui/react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import { Pagination } from "@heroui/react/pagination";
import { ChevronDown, ChevronRight, ArrowUpRightFromSquare, Xmark } from "@gravity-ui/icons";
import { RuntimeFormSurface } from "@/features/form-runtime/components";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";
import { getPaginationPageNumbers } from "@/features/records/screen/components/records-table/RecordsTablePrimitives";
import { RuntimeFormPanel } from "@/features/records/screen/components/RuntimeFormPanel";
import { RecordDetailDrawer } from "@/features/records/screen/components/record-detail/RecordDetailDrawer";
import { getAssociationPrimaryValue, getAssociationRecordId, getBuiltinRecordValues, getTableFieldDisplayValue, workflowApprovalStatusLabel, workflowInstanceStatusLabel } from "@/features/records/screen/form-record-utils";
import type { ViewConfig, ViewSortRule } from "@/features/records/screen/model/use-form-views";
import type { FormRecord } from "@/features/records/types";
import { MySurface } from "@/shared/ui/MySurface";
import { MyTable, type MyTableColumnMeta } from "@/shared/ui/MyTable";
import { CustomButtonFillDrawer } from "@/features/custom-buttons/components/CustomButtonFillDrawer";
import { CustomButtonPageDrawer, type CustomButtonPageTarget } from "@/features/records/screen/actions/CustomButtonPageDrawer";
import { buttonPageUrl } from "@/features/custom-buttons/model";
import { CustomButtonIcon } from "@/features/custom-buttons/icons";
import { getViewButtons, prepareButton, executeButton } from "@/features/custom-buttons/api";
import { evaluateBinding, type ButtonBinding } from "@/features/custom-buttons/bindings";
import { DEFAULT_DISABLED_REASON, type ButtonDefinition } from "@/features/custom-buttons/model";
import { RecordRowActions } from "@/features/records/screen/components/records-table/RecordRowActions";
import { useCopyRecord } from "@/features/records/model/use-copy-record";
import { WorkflowBuiltinTag } from "@/features/records/screen/components/records-table/WorkflowBuiltinTag";
import { RecordImagesCell } from "@/features/records/screen/components/records-table/RecordImagesCell";
import { getSubformDataRows, getSubformInstanceCount, type SubformDataRow } from "@/features/records/screen/components/records-table/subform-rows";
import type { FormSchema, RecordTableRow, AssociationDetail } from "./record-table-types";
import { TableSelectionContext, SelectionHeader, SelectionCell, RecordMembersCell, RecordSubmitterCell } from "./RecordTableCells";
import { getDynamicColumnWidth, useRecordTableLayout, useRecordTableValues } from "./use-record-table-layout";

type SchemaField = RuntimeSchemaField;

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

export function RecordsTable({
  readOnly = false,
  customButtonViewUuid = "default",
  customButtonBindings = [],
  customButtonConfigDirty = false,
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
  onRefreshRecords,
  canEditRecord,
  canCreateRecord,
  isDetailForm = false,
  canDeleteRecord,
  urlParams,
  onRecordSelectionChange,
  onPageSelectionChange,
  onViewConfigChange,
  initialRecordId,
  initialPageMode,
  initialTaskId,
  pagination,
}: {
  readOnly?: boolean;
  customButtonViewUuid?: string;
  customButtonBindings?: ButtonBinding[];
  customButtonConfigDirty?: boolean;
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
    action: "submit" | "reverse" | "withdraw",
    reason?: string,
  ) => Promise<boolean>;
  onCompleteExecutionTask: (
    taskId: string,
    changes: Record<string, unknown>,
  ) => Promise<boolean>;
  onRefreshRecords: () => Promise<void>;
  canEditRecord: boolean;
  canCreateRecord: boolean;
  isDetailForm?: boolean;
  canDeleteRecord: boolean;
  urlParams: Record<string, string>;
  onRecordSelectionChange: (recordId: string, selected: boolean) => void;
  onPageSelectionChange: (
    pageIds: string[],
    selectedPageIds: Set<string>,
  ) => void;
  onViewConfigChange: (
    patch: Partial<Pick<ViewConfig, "columnOrder" | "columnWidths" | "sorts">>,
  ) => void;
  initialRecordId?: string;
  initialPageMode?: "edit" | "view";
  initialTaskId?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
}) {
  const { copyRecord, copyingRecordId } = useCopyRecord(
    urlParams.formUuid,
    schema,
    canCreateRecord,
    isDetailForm,
  );
  const [buttonDefinitions, setButtonDefinitions] = useState<
    ButtonDefinition[]
  >([]);
  const [buttonFill, setButtonFill] = useState<{
    button: ButtonDefinition;
    recordId: string;
    viewUuid: string;
  } | null>(null);
  const [buttonPage, setButtonPage] = useState<CustomButtonPageTarget | null>(null);
  const [executingButtons, setExecutingButtons] = useState<Set<string>>(
    new Set(),
  );
  const buttonRequests = useRef(
    new Map<string, { requestId: string; pending: boolean }>(),
  );
  const bindingKey = JSON.stringify(customButtonBindings);
  useEffect(() => {
    let active = true;
    getViewButtons(urlParams.formUuid, customButtonViewUuid)
      .then((items) => {
        if (active)
          setButtonDefinitions(
            items.flatMap((item) => (item.definition ? [item.definition] : [])),
          );
      })
      .catch((e) => {
        if (active && bindingKey !== "[]") notifyRequestError(e, e.message);
      });
    return () => {
      active = false;
    };
  }, [
    urlParams.formUuid,
    customButtonViewUuid,
    customButtonConfigDirty,
    bindingKey,
  ]);
  const pageSizeOptions = [10, 20, 30, 40, 50];
  const { subformFields, hasSubforms, expandedSubformKeys, setExpandedSubformKeys, expandedRowKeys, columns, subformParents, memberUsers, tableColumns } = useRecordTableLayout({ schema, fields, builtinFields, columnOrder });
  const [detailRecord, setDetailRecord] = useState<FormRecord | null>(null);
  const autoOpenedRecordIdRef = useRef<string | null>(null);
  const [isDetailEditing, setIsDetailEditing] = useState(false);
  const detailSubmitModeRef = useRef<"save" | "complete">("save");
  const [detailTab, setDetailTab] = useState<"comments" | "history">(
    "comments",
  );
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
  const [associationDetailOpen, setAssociationDetailOpen] = useState(false);
  const { associationForms, recordDisplayValues, businessColumnWidths, builtInColumnWidths } = useRecordTableValues({ columns, subformParents, builtinFields, records, formName, formType, memberUsers, sortableFieldIds });
  const requestedPageSize = pagination?.pageSize ?? localPageSize;
  const pageSize =
    Number.isFinite(requestedPageSize) && requestedPageSize > 0
      ? requestedPageSize
      : 20;
  const requestedTotal = pagination?.total ?? records.length;
  const totalRecords =
    Number.isFinite(requestedTotal) && requestedTotal >= 0
      ? requestedTotal
      : records.length;
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize));
  const requestedPage = pagination?.page ?? localPage;
  const activePage = Math.min(
    Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1),
    pageCount,
  );
  const pageStart = (activePage - 1) * pageSize;
  const pageRecords = useMemo(
    () =>
      pagination ? records : records.slice(pageStart, pageStart + pageSize),
    [pagination, records, pageStart, pageSize],
  );
  const pageIds = useMemo(
    () => pageRecords.map((record) => record.id),
    [pageRecords],
  );
  const tableRows = useMemo<RecordTableRow[]>(
    () => {
      function childRow(parent: FormRecord, child: SubformDataRow): RecordTableRow {
        const record = { ...parent, id: child.id, data: child.data };
        const childRows = expandedSubformKeys.has(JSON.stringify([child.id, child.subformId]))
          ? getSubformDataRows(child.id, child.data, schema.fields, child.subformId).map((nested) => childRow(record, nested))
          : [];
        return {
          ...record, rowNumber: 0, subformId: child.subformId, subformLabel: child.label,
          subformCounts: Object.fromEntries(subformFields.map((field) => [field.id, getSubformInstanceCount(child.data, field.id)])),
          displayValues: {
            fields: Object.fromEntries(columns.map((field) => [field.id, subformParents.get(field.id) === child.subformId
              ? getTableFieldDisplayValue(field, record, associationForms, memberUsers) : ""])),
            builtIns: {},
          },
          children: childRows,
        };
      }
      return pageRecords.map((record, index) => ({
        ...record,
        rowNumber: pageStart + index + 1,
        displayValues: recordDisplayValues.get(record.id)!,
        subformCounts: Object.fromEntries(subformFields.map((field) => [field.id, getSubformInstanceCount(record.data, field.id)])),
        children: [...expandedSubformKeys]
          .filter((key) => {
            try { return (JSON.parse(key) as [string, string])[0] === record.id; } catch { return false; }
          })
          .flatMap((key) => {
            let subformId: string;
            try { subformId = (JSON.parse(key) as [string, string])[1]; } catch { return []; }
            return getSubformDataRows(record.id, record.data, schema.fields)
              .filter((child) => child.subformId === subformId)
              .map((child) => childRow(record, child));
          }),
      }));
    },
    [pageRecords, pageStart, recordDisplayValues, schema.fields, columns, subformParents, associationForms, memberUsers, subformFields, expandedSubformKeys],
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
      header: () => (
        <div className="flex items-center justify-center">
          <SelectionHeader />
        </div>
      ),
      cell: ({ row }) => row.original.subformId ? null : (
        <SelectionCell
          recordId={row.original.id}
          rowNumber={row.original.rowNumber}
        />
      ),
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
            : column.kind === "subformSummary"
              ? getDynamicColumnWidth(field.label, records.map((record) => String(getSubformInstanceCount(record.data, id))), false, 180)
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
                : column.kind === "subformSummary"
                  ? String(record.subformCounts?.[id] ?? 0)
                : (record.displayValues.fields[id] ??
                  record.displayValues.builtIns[id] ??
                  ""),
          header: field.label,
          size: defaultWidth,
          minSize: Math.min(column.kind === "subformSummary" ? 48 : 80, defaultWidth),
          enableSorting: column.kind !== "subformSummary" && sortableFieldIds.includes(id),
          meta,
          cell: ({ row }) => {
            const record = row.original;
            if (column.kind === "subformSummary") {
              if (record.subformId !== column.parentSubformId) return null;
              const count = record.subformCounts?.[id] ?? 0;
              const expansionKey = JSON.stringify([record.id, id]);
              const isExpanded = expandedSubformKeys.has(expansionKey);
              return (
                <div className="flex items-center">
                  <Chip size="sm" variant="soft" className="inline-flex items-center gap-1 pr-1">
                    {count}
                  {count > 0 ? (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      className="!size-5 !min-w-5 !p-0"
                      aria-label={isExpanded ? `收起${field.label}` : `展开${field.label}`}
                      onPress={() => setExpandedSubformKeys((current) => {
                        const next = new Set(current);
                        if (next.has(expansionKey)) next.delete(expansionKey);
                        else next.add(expansionKey);
                        return next;
                      })}
                    >
                      {isExpanded ? <ChevronDown aria-hidden="true" className="size-3.5" /> : <ChevronRight aria-hidden="true" className="size-3.5" />}
                    </Button>
                  ) : null}
                  </Chip>
                </div>
              );
            }
            if (record.subformId && column.kind !== "field") return null;
            if (column.kind === "field" && subformParents.get(id) !== record.subformId) return null;
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
                <RecordSubmitterCell record={record} showOrganization />
              );
            if (
              column.kind === "builtin" &&
              [
                "workflowApprovalStatus",
                "workflowInstanceStatus",
                "workflowCurrentApprovalNode",
              ].includes(id)
            ) {
              return (
                <WorkflowBuiltinTag
                  fieldId={id}
                  label={record.displayValues.builtIns[id] ?? ""}
                  value={record.data[id]}
                  instanceStatus={record.data.workflowInstanceStatus}
                />
              );
            }
            if (column.kind === "builtin")
              if (id === "submitter")
                return <RecordSubmitterCell record={record} />;
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
            if (schemaField.type === "member") {
              return (
                <RecordMembersCell
                  value={record.data[schemaField.id]}
                  users={memberUsers}
                  displayFormat={schemaField.props?.memberDisplayFormat}
                />
              );
            }
            if (schemaField.type === "imageUpload") {
              return <RecordImagesCell value={record.data[schemaField.id]} />;
            }
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
                onPress={() => {
                  setAssociationDetail({
                    field: schemaField,
                    record: relatedRecord,
                    schema: association.schema,
                  });
                  setAssociationDetailOpen(true);
                }}
                className="inline-flex max-w-full cursor-pointer items-center gap-1 text-[var(--color-primary)] hover:underline"
              >
                <span className="min-w-0 truncate" title={displayValue}>
                  {displayValue}
                </span>
                <ArrowUpRightFromSquare
                  className="size-3 shrink-0"
                  aria-hidden="true"
                />
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
        if (record.subformId) return null;
        return (
          <RecordRowActions
              readOnly={readOnly}
            record={record}
            customActions={customButtonBindings.flatMap((binding) => {
              const button = buttonDefinitions.find(
                (item) => item.id === binding.buttonId,
              );
              if (!button) return [];
              const actionKey = `${urlParams.formUuid}:${customButtonViewUuid}:${button.id}:${record.id}`;
              const missingAutomation = button.actionType === "run_automation" && !button.actionConfig.automationId;
              const missingAssociation = button.actionType === "fill_form" && button.actionConfig.targetFormUuid !== urlParams.formUuid && !button.actionConfig.associationRules?.length;
              const enabled =
                !missingAssociation &&
                !missingAutomation &&
                !customButtonConfigDirty &&
                !executingButtons.has(actionKey) &&
                evaluateBinding(button, record);
              return [
                {
                  id: `custom-${button.id}`,
                  label: button.name,
                  icon: <CustomButtonIcon icon={button.icon} />,
                  isDisabled: !enabled,
                  disabledReason: enabled
                    ? undefined
                    : missingAssociation
                      ? "需重新配置：请补充关联实例条件"
                      : missingAutomation
                      ? "按钮未绑定集成自动化，请重新配置"
                      : executingButtons.has(actionKey)
                      ? "正在触发自动化…"
                      : customButtonConfigDirty
                        ? "请先保存视图配置"
                        : button.disabledReason.trim() ||
                          DEFAULT_DISABLED_REASON,
                  onAction: () => {
                    if (!enabled) return;
                    if (button.actionType === "run_automation") {
                      const existing = buttonRequests.current.get(actionKey);
                      if (existing?.pending) return;
                      const request = {
                        requestId: existing?.requestId ?? crypto.randomUUID(),
                        pending: true,
                      };
                      buttonRequests.current.set(actionKey, request);
                      setExecutingButtons((current) =>
                        new Set(current).add(actionKey),
                      );
                      void executeButton(
                        urlParams.formUuid,
                        customButtonViewUuid,
                        button.id,
                        record.id,
                        request.requestId,
                      )
                        .then((result) => {
                          buttonRequests.current.delete(actionKey);
                          notify.success(`已触发集成自动化（${result.runId}）`);
                        })
                        .catch((error) => {
                          request.pending = false;
                          notifyRequestError(error, error.message || "触发失败");
                        })
                        .finally(() => {
                          setExecutingButtons((current) => {
                            const next = new Set(current);
                            next.delete(actionKey);
                            return next;
                          });
                        });
                      return;
                    }
                    const pageWindow =
                      button.actionType === "open_page" &&
                      button.actionConfig.openMode !== "sidebar"
                        ? window.open("about:blank", "_blank")
                        : null;
                    if (pageWindow) pageWindow.opener = null;
                    void prepareButton(
                      urlParams.formUuid,
                      customButtonViewUuid,
                      button.id,
                      record.id,
                    )
                      .then((latest) => {
                        if (latest.actionType === "open_page") {
                          const url = buttonPageUrl(
                            latest,
                            record.formUuid,
                            record.id,
                            { ...getBuiltinRecordValues(record, formName, formType === "workflow"), ...record.data, instanceId: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, submitter: record.createdBy },
                          );
                          if (latest.actionConfig.openMode === "sidebar") {
                            pageWindow?.close();
                            setButtonPage({
                              button: latest,
                              url,
                              record: latest.actionConfig.targetFormUuid === record.formUuid
                                ? { id: record.id, data: record.data }
                                : undefined,
                            });
                          } else if (pageWindow) pageWindow.location.href = url;
                          else
                            window.open(url, "_blank", "noopener,noreferrer");
                        } else {
                          pageWindow?.close();
                          setButtonFill({
                            button: latest,
                            recordId: record.id,
                            viewUuid: customButtonViewUuid,
                          });
                        }
                      })
                      .catch((e) => {
                        pageWindow?.close();
                        notifyRequestError(e, e.message);
                      });
                  },
                },
              ];
            })}
            formType={formType}
            submitting={submitting}
            canCreateRecord={canCreateRecord}
            copyingRecordId={copyingRecordId}
            canDeleteRecord={canDeleteRecord}
            deletingRecordId={deletingRecordId}
            onOpenDetail={() => openDetail(record)}
            onWorkflowAction={(action) =>
              void workflowActionRef.current(record, action)
            }
            onDelete={() => setDeleteRecordTarget(record)}
            onCopy={() => void copyRecord(record)}
          />
        );
      },
    };
    return [selectionColumn, ...dataColumns, actionColumn];
  }, [
    associationForms,
    setExpandedSubformKeys,
    subformParents,
    executingButtons,
    buttonDefinitions,
    customButtonBindings,
    customButtonConfigDirty,
    customButtonViewUuid,
    urlParams.formUuid,
    builtInColumnWidths,
    businessColumnWidths,
    canDeleteRecord,
    readOnly,
    canCreateRecord,
    copyRecord,
    copyingRecordId,
    deletingRecordId,
    formName,
    formType,
    frozenFieldIds,
    expandedSubformKeys,
    records,
    memberUsers,
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
  }

  useEffect(() => {
    if (!initialRecordId || autoOpenedRecordIdRef.current === initialRecordId)
      return;
    const record = records.find((item) => item.id === initialRecordId);
    if (!record) return;
    autoOpenedRecordIdRef.current = initialRecordId;
    const timer = window.setTimeout(
      () =>
        openDetail(
          record,
          Boolean(initialTaskId) ||
            (initialPageMode === "edit" && canEditRecord),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [initialRecordId, initialTaskId, initialPageMode, canEditRecord, records]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsDetailContentReady(Boolean(detailRecord));
    });
    return () => cancelAnimationFrame(frame);
  }, [detailRecord, isDetailEditing]);

  const handleDetailFormSubmit = useCallback(
    async (values: Record<string, unknown>) => {
      if (!isDetailEditing || !detailRecord) return;
      const completingTask =
        detailSubmitModeRef.current === "complete" &&
        initialTaskId &&
        detailRecord.id === initialRecordId;
      const updated = completingTask
        ? await onCompleteExecutionTask(
            initialTaskId,
            Object.fromEntries(
              Object.entries(values).filter(
                ([key, value]) =>
                  JSON.stringify(value) !==
                  JSON.stringify(detailRecord.data[key]),
              ),
            ),
          )
        : await onUpdateRecord(detailRecord.id, values);
      if (updated) {
        if (
          !completingTask &&
          initialTaskId &&
          detailRecord.id === initialRecordId
        ) {
          setDetailRecord({
            ...detailRecord,
            data: { ...detailRecord.data, ...values },
          });
          return;
        }
        setDetailRecord(null);
        setIsDetailEditing(false);
      }
    },
    [
      detailRecord,
      initialRecordId,
      initialTaskId,
      isDetailEditing,
      onCompleteExecutionTask,
      onUpdateRecord,
    ],
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
    } catch (requestError) {
      notifyRequestError(requestError, "当前浏览器不支持复制，请手动选择文本");
    }
  }

  return (
    <>
      {buttonFill ? (
        <CustomButtonFillDrawer
          button={buttonFill.button}
          sourceFormUuid={urlParams.formUuid}
          viewUuid={buttonFill.viewUuid}
          recordId={buttonFill.recordId}
          onSaved={() => { void onRefreshRecords(); }}
          onClose={() => setButtonFill(null)}
        />
      ) : null}
      {buttonPage ? (
        <CustomButtonPageDrawer
          target={buttonPage}
          onClose={() => setButtonPage(null)}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <MySurface className="min-h-0 min-w-0 flex-1 overflow-hidden p-0">
          <TableSelectionContext.Provider
            value={{
              selectedIds: selectedRecordIds,
              pageIds,
              onRowChange: onRecordSelectionChange,
              onPageChange: (selectedPageIds) =>
                onPageSelectionChange(pageIds, selectedPageIds),
            }}
          >
            <MyTable
              ariaLabel="表单提交数据"
              data={tableRows}
              columns={myTableColumns}
              getRowId={(record) => record.id}
              getSubRows={(record) => record.children}
              treeColumn={hasSubforms ? (tableColumns.find((column) => column.kind === "subformSummary")?.field.id ?? tableColumns[0]?.field.id) : undefined}
              showTreeExpander={false}
              isExpandableRow={(record) => !record.subformId && hasSubforms}
              expandedKeys={expandedRowKeys}
              className="flex-1"
              sortDescriptor={sortDescriptor}
              onSortChange={handleSortChange}
              selectedRowIds={selectedRecordIds}
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
      <RecordDetailDrawer
        isOpen={detailRecord !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDetailRecord(null);
            setIsDetailEditing(false);
          }
        }}
        formName={formName}
        readOnly={readOnly}
        schema={schema}
        record={detailRecord}
        urlParams={urlParams}
        submitting={submitting}
        formType={formType}
        showAuxiliary
        builtIns={detailBuiltIns}
        previousDisabled={detailRecordIndex <= 0}
        nextDisabled={detailRecordIndex < 0 || detailRecordIndex >= records.length - 1}
        onPrevious={() => showAdjacentRecord(-1)}
        onNext={() => showAdjacentRecord(1)}
        onCopy={() => void copyDetailRecord()}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        isEditing={isDetailEditing}
        onEditingChange={setIsDetailEditing}
        onSubmit={handleDetailFormSubmit}
        onSubmitMode={(mode) => { detailSubmitModeRef.current = mode; }}
        canEdit={canEditRecord}
        canDelete={canDeleteRecord}
        isDeleting={detailRecord !== null && deletingRecordId === detailRecord.id}
        onDelete={() => detailRecord && setDeleteRecordTarget(detailRecord)}
        canComplete={Boolean(initialTaskId && detailRecord?.id === initialRecordId)}
        onWorkflowAction={(action) => onWorkflowAction(detailRecord!, action)}
        onCompleteExecutionTask={onCompleteExecutionTask}
        onWorkflowTaskHandled={onRefreshRecords}
        isContentReady={isDetailContentReady}
      />
      <Modal.Backdrop
        isOpen={associationDetailOpen}
        onOpenChange={setAssociationDetailOpen}
        className="theme-modal-backdrop"
        isDismissable
      >
        <Modal.Container placement="center" scroll="inside" size="cover">
          <Modal.Dialog className="w-[1280px]">
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
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto">
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
      <AlertDialog.Backdrop
        isOpen={deleteRecordTarget !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && deletingRecordId === null) setDeleteRecordTarget(null);
        }}
        className="theme-modal-backdrop"
      >
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>删除数据</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="">
              <p>确认删除这条数据吗？删除后无法恢复。</p>
              {workflowDeleteWarning ? (
                <div className="mt-4 border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
                  <p className="font-medium">
                    该流程记录已进入审批或实例生命周期。
                  </p>
                  <p className="mt-1 text-[var(--color-text-secondary)]">
                    审批状态：
                    {workflowApprovalStatusLabel(
                      deleteRecordTarget?.data.workflowApprovalStatus,
                    )}
                    ；实例状态：
                    {workflowInstanceStatusLabel(
                      deleteRecordTarget?.data.workflowInstanceStatus,
                    )}
                    。
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
    </>
  );
}
