"use client";

import { notifyRequestError } from "@/shared/lib/notify";
import { notify } from "@/shared/lib/notify";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Label, Badge, Button, Dropdown, ListBox, SearchField, Select, ButtonGroup } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import { Drawer } from "@heroui/react/drawer";
import { FormViewTabs } from "@/features/records/screen/components/FormViewTabs";
import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { ArrowDownToLine, ArrowUpFromLine, BroomMotion, Ellipsis, Pencil, Plus, Sliders, TrashBin } from "@gravity-ui/icons";
import { RuntimeFormSurface } from "@/features/form-runtime";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import { getSystemPageBySlug, isSystemPageSlug } from "@/features/application/system-pages";
import { RecordsTable } from "@/features/records/screen/components/records-table/RecordsTable";
import { RuntimeFormPanel } from "@/features/records/screen/components/RuntimeFormPanel";
import { SystemPageView } from "@/features/records/screen/components/SystemPageView";
import { formatDateTime, getDetailParentRecordLabel, getVisibleDataFields } from "@/features/records/screen/form-record-utils";
import { useDetailFormsQuery, useFormBootstrapQuery, useParentRecordsQuery, useRecordsQuery } from "@/features/records/queries";
import { completeWorkflowExecutionTask, runWorkflowRecordAction, useRecordMutations } from "@/features/records/mutations";
import type { FormRecord } from "@/features/records/types";
import { mergePageSelection, retainAvailableSelection } from "@/features/records/selection";
import { normalizeDetailFormSchema } from "@/features/records/model/schema";
import { useRecordDrafts, type RecordFormDraft } from "@/features/records/screen/model/drafts";
import { useRecordEditor } from "@/features/records/screen/model/use-record-editor";
import { BUILTIN_RECORD_FIELDS, BUILTIN_RECORD_FIELD_LABELS, WORKFLOW_BUILTIN_RECORD_FIELDS, getViewFieldTypeLabel } from "@/features/form-model/field-metadata";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notifyAppNavigationChanged } from "@/features/application/navigation-events";
import { DetailDisplayFieldSelect, IconToolbarButton, type ViewFieldOption } from "@/features/records/screen/components/view-settings/ViewConfigComponents";
import { FormTableSetting } from "@/features/records/screen/components/view-settings/FormTableSetting";
import { getSubformAncestors } from "@/features/records/screen/components/records-table/subform-rows";
import { FormDataImportDrawer } from "@/features/records/screen/components/FormDataImportDrawer";
import { useFormViews, type FormView, type ViewConfig } from "@/features/records/screen/model/use-form-views";
import { useRecordWorkbook } from "../model/use-record-workbook";

type FormSchema = RuntimeFormSchema;

const EMPTY_COLUMN_WIDTHS: Record<string, number> = {};
const EMPTY_FROZEN_FIELD_IDS: string[] = [];
const COMBINED_VIEW_FIELD_GROUPS: Array<{
  id: string;
  label: string;
  fieldIds: string[];
}> = [
  {
    id: "instanceId",
    label: "实例标题",
    fieldIds: ["instanceId", "instanceTitle"],
  },
  {
    id: "submitter",
    label: "创建人&组织",
    fieldIds: ["submitter", "submitterOrganization"],
  },
];

export function FormHomeRecords({
  appId,
  formUuid,
  embedded,
  readOnly,
  pageParameters,
}: {
  appId: string;
  formUuid: string;
  embedded: boolean;
  readOnly: boolean;
  pageParameters?: Record<string, string>;
}) {
  const { hasPermission } = useAuth();
  const canCreateRecord = !readOnly && hasPermission(`form:${formUuid}:create`);
  const canEditRecord = !readOnly && hasPermission(`form:${formUuid}:edit`);
  const canDeleteRecord = !readOnly && hasPermission(`form:${formUuid}:delete`);
  const canBulkDeleteRecords =
    !readOnly &&
    hasPermission(`form:${formUuid}:bulk_delete`) &&
    hasPermission(`form:${formUuid}:delete`);
  const canUseViewDevelopment = !embedded && hasPermission(`app:${appId}:view_development`);
  const canEditForm = !embedded && hasPermission(`app:${appId}:edit_form`);
  const canDeleteForm = !embedded && hasPermission(`app:${appId}:delete_form`);
  const canImportRecords = canUseViewDevelopment;
  const canExportRecords = canUseViewDevelopment;
  const router = useRouter();
  const queryClient = useQueryClient();
  const recordMutations = useRecordMutations(formUuid);
  const recordEditor = useRecordEditor(
    formUuid,
    {},
    {
      create: (values) => recordMutations.create.mutateAsync(values),
      update: (recordUuid, values) =>
        recordMutations.update.mutateAsync({ recordUuid, values }),
    },
  );
  const routeSearchParams = useSearchParams();
  const embeddedSearchParams = useMemo(() => new URLSearchParams(pageParameters ?? {}), [pageParameters]);
  const searchParams = embedded ? embeddedSearchParams : routeSearchParams;
  const runtimeUrlParams = useMemo(() => ({ ...Object.fromEntries(searchParams.entries()), appId, formUuid }), [searchParams, appId, formUuid]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerValues, setDrawerValues] = useState<Record<string, unknown>>({});
  const [drawerResetKey, setDrawerResetKey] = useState(0);
  const drawerSubmitModeRef = useRef<"submit" | "continue">("submit");
  const {
    drafts,
    saveDraft: persistDraft,
    deleteDraft: removeDraft,
  } = useRecordDrafts(formUuid);
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(20);
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detailFormOpen, setDetailFormOpen] = useState(false);
  const [detailSubformId, setDetailSubformId] = useState("");
  const [createdDetailSubformIds, setCreatedDetailSubformIds] = useState<
    Set<string>
  >(() => new Set());
  const [newDetailPrimaryDisplayFieldId, setNewDetailPrimaryDisplayFieldId] =
    useState("");
  const [
    newDetailSecondaryDisplayFieldId,
    setNewDetailSecondaryDisplayFieldId,
  ] = useState("");
  const [creatingDetailForm, setCreatingDetailForm] = useState(false);
  const [detailParentRecordUuid, setDetailParentRecordUuid] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const viewUrlTransitionRef = useRef<{ viewUuid: string | null } | null>(null);

  const bootstrapQuery = useFormBootstrapQuery(
    appId,
    formUuid,
    !isSystemPageSlug(formUuid),
  );

  const bootstrap = bootstrapQuery.data;
  const formMetadataName = bootstrap?.metadata.name ?? "";
  const formType =
    bootstrap?.metadata.formType === "workflow" ? "workflow" : "normal";
  const isDetailForm = bootstrap?.metadata.formType === "detail";
  const detailFormsQuery = useDetailFormsQuery(
    formUuid,
    !isDetailForm && !isSystemPageSlug(formUuid),
  );
  const existingDetailSubformIds = useMemo(
    () =>
      new Set([
        ...(detailFormsQuery.data ?? []).map((detail) => detail.subformFieldId),
        ...createdDetailSubformIds,
      ]),
    [createdDetailSubformIds, detailFormsQuery.data],
  );
  const systemPageTitle = isSystemPageSlug(formUuid)
    ? (getSystemPageBySlug(formUuid)?.title ?? null)
    : null;
  const schema = useMemo(
    () =>
      bootstrap
        ? normalizeDetailFormSchema(
            bootstrap.schema.schema as FormSchema,
            bootstrap.metadata.formType === "detail",
          )
        : null,
    [bootstrap],
  );

  const submitButtonText =
    schema?.pageProps?.submitButtonText?.trim() || "提交";
  const visibleFields = useMemo(
    () => getVisibleDataFields(schema?.fields ?? []),
    [schema?.fields],
  );
  const subformFields = useMemo(
    () => (schema?.fields ?? []).filter((field) => field.type === "subform"),
    [schema?.fields],
  );
  const availableDetailSubformFields = useMemo(
    () =>
      subformFields.filter((field) => !existingDetailSubformIds.has(field.id)),
    [existingDetailSubformIds, subformFields],
  );
  const detailDisplayFields = useMemo(
    () =>
      (schema?.fields ?? []).filter(
        (field) =>
          ![
            "subform",
            "description",
            "groupContainer",
            "separator",
            "button",
            "link",
            "html",
            "tsx",
          ].includes(field.type),
      ),
    [schema?.fields],
  );
  const builtinRecordFields = useMemo(
    () =>
      formType === "workflow"
        ? [...WORKFLOW_BUILTIN_RECORD_FIELDS, ...BUILTIN_RECORD_FIELDS]
        : BUILTIN_RECORD_FIELDS,
    [formType],
  );
  const detailDisplayFieldOptions = useMemo(
    () => [
      ...detailDisplayFields.map((field) => ({
        id: field.id,
        label: field.label,
      })),
      ...builtinRecordFields.map((field) => ({
        id: field.id,
        label: field.label,
      })),
    ],
    [builtinRecordFields, detailDisplayFields],
  );
  const detailPageProps = schema?.pageProps as unknown as
    | Record<string, unknown>
    | undefined;
  const detailSourceFormUuid = detailPageProps?.detailSourceFormUuid as
    | string
    | undefined;
  const detailPrimaryDisplayFieldId =
    (detailPageProps?.detailPrimaryDisplayFieldId as string | undefined) ??
    "instanceId";
  const detailSecondaryDisplayFieldId =
    (detailPageProps?.detailSecondaryDisplayFieldId as string | undefined) ??
    "submitter";
  const allViewFields = useMemo(
    () => [
      ...visibleFields.map((field) => ({
        id: field.id,
        label: [
          ...getSubformAncestors(field, schema?.fields ?? []).map(
            (parent) => parent.label,
          ),
          field.label,
        ].join("."),
        type: field.type,
        typeLabel: getViewFieldTypeLabel(field.type),
        parentSubformId: getSubformAncestors(
          field,
          schema?.fields ?? [],
        ).at(-1)?.id,
        isSubformGroup: field.type === "subform",
      })),
      ...builtinRecordFields.map((field) => ({
        ...field,
        type: "builtin",
        typeLabel: "内置字段",
      })),
    ],
    [builtinRecordFields, schema?.fields, visibleFields],
  );
  const queryableViewFields = useMemo(
    () =>
      allViewFields.filter(
        (field) =>
          field.type !== "subform" &&
          !["instanceTitle", "submitterOrganization"].includes(field.id),
      ),
    [allViewFields],
  );
  const defaultViewConfig = useMemo<ViewConfig>(
    () => ({
      visibleFieldIds: allViewFields
        .filter((field) => field.type !== "subform")
        .map((field) => field.id),
      sortableFieldIds: queryableViewFields.map((field) => field.id),
      filters: [],
      sorts: [],
      columnOrder: allViewFields.map((field) => field.id),
      columnWidths: {},
      frozenFieldIds: [],
    }),
    [allViewFields, queryableViewFields],
  );
  const formViews = useFormViews({
    formUuid,
    defaultViewConfig,
    enabled: Boolean(schema),
  });
  const {
    activeViewId,
    applyViewConfigDraft,
    closeViewConfig,
    confirmDeleteView,
    createTableView,
    effectiveViewConfig,
    openViewConfig,
    saveViewConfig,
    setActiveViewId,
    setPendingViewConfig,
    setViewConfigDraft,
    setViewConfigMode,
    setViewDeleteTarget,
    viewConfigDirty,
    viewConfigDraft,
    viewConfigMode,
    viewDeleteTarget,
    views,
    isReady: isViewConfigReady,
  } = formViews;
  const viewFieldOrderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const orderedDraftViewFields = useMemo<ViewFieldOption[]>(() => {
    const order =
      viewConfigDraft?.columnOrder ?? allViewFields.map((field) => field.id);
    const fieldById = new Map(allViewFields.map((field) => [field.id, field]));
    const remaining = new Set(fieldById.keys());
    const ordered = order.flatMap((fieldId) => {
      const field = fieldById.get(fieldId);
      if (!field) return [];
      remaining.delete(fieldId);
      return [field];
    });
    const allOrdered = [
      ...ordered,
      ...allViewFields.filter((field) => remaining.has(field.id)),
    ];
    const frozenIds = new Set(viewConfigDraft?.frozenFieldIds ?? []);
    const frozenOrdered = [
      ...allOrdered.filter((field) => frozenIds.has(field.id)),
      ...allOrdered.filter((field) => !frozenIds.has(field.id)),
    ];
    const renderedGroupIds = new Set<string>();
    return frozenOrdered.flatMap<ViewFieldOption>((field) => {
      const group = COMBINED_VIEW_FIELD_GROUPS.find((candidate) =>
        candidate.fieldIds.includes(field.id),
      );
      if (!group) return [field];
      if (renderedGroupIds.has(group.id)) return [];
      renderedGroupIds.add(group.id);
      const primaryField = fieldById.get(group.id);
      return primaryField
        ? [
            {
              ...primaryField,
              label: group.label,
              linkedFieldIds: [...group.fieldIds],
            },
          ]
        : [field];
    });
  }, [
    allViewFields,
    viewConfigDraft?.columnOrder,
    viewConfigDraft?.frozenFieldIds,
  ]);

  const orderedViewFieldIds = useMemo(() => {
    const visibleIds = allViewFields
      .filter(
        (field) =>
          field.type === "subform" ||
          effectiveViewConfig.visibleFieldIds.includes(field.id),
      )
      .map((field) => field.id)
    const knownIds = new Set(visibleIds);
    const ordered = [
      ...(effectiveViewConfig.columnOrder ?? []).filter((fieldId) =>
        knownIds.delete(fieldId),
      ),
      ...visibleIds.filter((fieldId) => knownIds.has(fieldId)),
    ];
    const frozenIds = new Set(effectiveViewConfig.frozenFieldIds ?? []);
    return [
      ...ordered.filter((fieldId) => frozenIds.has(fieldId)),
      ...ordered.filter((fieldId) => !frozenIds.has(fieldId)),
    ];
  }, [
    allViewFields,
    effectiveViewConfig.columnOrder,
    effectiveViewConfig.frozenFieldIds,
    effectiveViewConfig.visibleFieldIds,
  ]);
  const configuredFields = useMemo(() => {
    const fieldsById = new Map(visibleFields.map((field) => [field.id, field]));
    return orderedViewFieldIds.flatMap((fieldId) => {
      const field = fieldsById.get(fieldId);
      return field && field.type !== "subform" ? [field] : [];
    });
  }, [orderedViewFieldIds, visibleFields]);
  const configuredBuiltinFields = useMemo(() => {
    const fieldsById = new Map<string, { id: string; label: string }>(
      builtinRecordFields.map((field) => [field.id, field]),
    );
    return orderedViewFieldIds.flatMap((fieldId) => {
      const field = fieldsById.get(fieldId);
      return field ? [field] : [];
    });
  }, [builtinRecordFields, orderedViewFieldIds]);
  const sortableFieldIds = useMemo(
    () =>
      (
        effectiveViewConfig.sortableFieldIds ??
        allViewFields.map((field) => field.id)
      ).filter((fieldId) =>
        effectiveViewConfig.visibleFieldIds.includes(fieldId),
      ),
    [
      allViewFields,
      effectiveViewConfig.sortableFieldIds,
      effectiveViewConfig.visibleFieldIds,
    ],
  );
  const recordFilters = useMemo(
    () =>
      effectiveViewConfig.filters
        .filter(
          (rule) =>
            rule.value.trim() &&
            queryableViewFields.some((field) => field.id === rule.fieldId),
        )
        .map((rule) => ({
          fieldId: rule.fieldId,
          operator: (
            {
              contains: "contains",
              equals: "eq",
              notEquals: "neq",
              greaterThan: "gt",
              lessThan: "lt",
            } as const
          )[rule.operator],
          value: rule.value,
        })),
    [effectiveViewConfig.filters, queryableViewFields],
  );
  const recordSorts = useMemo(
    () =>
      effectiveViewConfig.sorts
        .filter((rule) =>
          queryableViewFields.some((field) => field.id === rule.fieldId),
        )
        .map((rule) => ({
          fieldId: rule.fieldId,
          direction: rule.direction,
        })),
    [effectiveViewConfig.sorts, queryableViewFields],
  );
  const executionTaskId = searchParams.get("task") ?? undefined;
  const executionRecordId = executionTaskId ? searchParams.get("record") : null;
  const recordsQuery = useRecordsQuery({
    formUuid,
    page: recordPage,
    pageSize: recordPageSize,
    filters: executionRecordId
      ? [{ fieldId: "instanceId", operator: "eq", value: executionRecordId }]
      : recordFilters,
    sorts: recordSorts,
    detail: isDetailForm,
    enabled: Boolean(schema) && !isSystemPageSlug(formUuid),
    initialData:
      recordPage === 1 &&
      recordPageSize === 20 &&
      !executionRecordId &&
      recordFilters.length === 0 &&
      recordSorts.length === 0
        ? bootstrap?.records
        : undefined,
  });
  const displayedRecords = useMemo(
    () => (recordsQuery.data?.items ?? []) as FormRecord[],
    [recordsQuery.data?.items],
  );
  const searchableRecords = useMemo(
    () =>
      displayedRecords.map((record) => ({
        record,
        searchText: Object.values(record.data)
          .map(toSearchText)
          .join("\u0000")
          .toLowerCase(),
      })),
    [displayedRecords],
  );
  const searchedRecords = useMemo(() => {
    const query = deferredSearchValue.trim().toLowerCase();
    if (!query) return displayedRecords;
    return searchableRecords
      .filter((entry) => entry.searchText.includes(query))
      .map((entry) => entry.record);
  }, [deferredSearchValue, displayedRecords, searchableRecords]);
  useEffect(() => {
    if (embedded) return;
    if (!views.length) return;
    const requestedViewUuid = searchParams.get("viewUuid");
    const pendingTransition = viewUrlTransitionRef.current;
    if (pendingTransition && pendingTransition.viewUuid !== requestedViewUuid)
      return;
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
  }, [
    activeViewId,
    embedded,
    searchParams,
    setActiveViewId,
    setPendingViewConfig,
    setViewConfigDraft,
    views,
  ]);

  async function handleCreateTableView() {
    const view = await createTableView();
    if (view) activateTableView(view);
  }

  async function handleConfirmDeleteView() {
    const view = await confirmDeleteView();
    if (view) activateTableView(view);
  }

  const loadRecords = useCallback(async () => {
    if (isSystemPageSlug(formUuid)) return;
    await queryClient.invalidateQueries({
      queryKey: ["form-records", formUuid],
    });
  }, [formUuid, queryClient]);

  const parentRecordsQuery = useParentRecordsQuery(detailSourceFormUuid);
  const detailParentRecords = useMemo(
    () => (parentRecordsQuery.data?.items ?? []) as FormRecord[],
    [parentRecordsQuery.data?.items],
  );

  async function handleCreateRecord(
    values: Record<string, unknown>,
    source: "drawer" | "drawerContinue",
  ) {
    if (detailSourceFormUuid && !detailParentRecordUuid) {
      notify.error("请选择归属主记录");
      return;
    }
    setSubmitting(true);

    try {
      await recordEditor.submitCreate(
        detailSourceFormUuid
          ? { ...values, __parentRecordUuid: detailParentRecordUuid }
          : values,
      );

      await loadRecords();
      notify.success("表单数据已保存", {
        description: "记录已保存，后置自动化将在后台执行",
      });

      if (source === "drawer") {
        setDrawerOpen(false);
        router.replace(`/${appId}/${formUuid}`);
      }
      if (source === "drawerContinue") {
        setDrawerValues({});
        setDrawerResetKey((current) => current + 1);
      }
    } catch (error) {
      notifyRequestError(error, "提交失败", {
        description:
          error instanceof Error ? error.message : "请确认后端服务正常。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateDetailForm() {
    if (!detailSubformId) return;
    if (existingDetailSubformIds.has(detailSubformId)) {
      notify.error("该子表单已生成明细表单");
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
      setCreatedDetailSubformIds(
        (current) => new Set([...current, detailSubformId]),
      );
      setDetailFormOpen(false);
      notifyAppNavigationChanged(appId);
      router.push(`/${appId}/${detailForm?.detailFormUuid ?? ""}`);
    } catch (error) {
      notifyRequestError(error, "创建明细表单失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
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
      await recordEditor.submitUpdate(recordId, values);

      await loadRecords();
      notify.success("表单数据已更新，后置自动化将在后台执行", {
        description: `记录 ${recordId} 已保存`,
      });
      return true;
    } catch (requestError) {
      notifyRequestError(requestError, "更新失败", {
        description: "请确认后端服务正常。",
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWorkflowAction(
    record: FormRecord,
    action: "submit" | "reverse" | "withdraw",
  ): Promise<boolean> {
    try {
      await runWorkflowRecordAction(formUuid, record.id, action);
      await loadRecords();
      notify.success(
        (
          {
            submit: "流程已提交",
            reverse: "反审成功",
            withdraw: "已撤销提交",
          } as Record<typeof action, string>
        )[action],
      );
      return true;
    } catch (error) {
      notifyRequestError(error, "流程操作失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
      return false;
    }
  }

  async function handleCompleteExecutionTask(
    taskId: string,
    changes: Record<string, unknown>,
  ): Promise<boolean> {
    setSubmitting(true);
    try {
      await completeWorkflowExecutionTask(taskId, changes);
      await loadRecords();
      notify.success("填写完成，流程已流转");
      router.push(`/${appId}/tasks`);
      return true;
    } catch (error) {
      notifyRequestError(error, "执行任务失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRecord(recordId: string): Promise<boolean> {
    setDeletingRecordId(recordId);

    try {
      await recordMutations.remove.mutateAsync(recordId);

      await loadRecords();
      notify.success("记录已删除，后置自动化将在后台执行", {
        description: `记录 ${recordId} 已移除`,
      });
      return true;
    } catch (requestError) {
      notifyRequestError(requestError, "删除记录失败", {
        description: "请确认后端服务正常。",
      });
      return false;
    } finally {
      setDeletingRecordId(null);
    }
  }

  async function handleBulkDeleteRecords() {
    if (isBulkDeleting || selectedRecordIds.size === 0) return;
    setIsBulkDeleting(true);
    const ids = [...selectedRecordIds];
    let deletedCount = 0;
    let failedCount = 0;
    try {
      for (const id of ids) {
        try {
          await recordMutations.remove.mutateAsync(id);
          deletedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      setSelectedRecordIds(new Set());
      await loadRecords();
      setIsBulkDeleteOpen(false);
      if (failedCount === 0) {
        notify.success(`已删除 ${deletedCount} 条记录`);
      } else {
        notify.warning(`批量删除完成：成功 ${deletedCount} 条，失败 ${failedCount} 条`);
      }
    } finally {
      setIsBulkDeleting(false);
    }
  }

  async function handleDeleteForm() {
    setDeleting(true);

    try {
      await recordMutations.removeForm.mutateAsync();

      setDeleteOpen(false);
      notify.success("表单已删除", {
        description: `表单 ${formUuid} 已移除`,
      });
      notifyAppNavigationChanged(appId);
      router.replace(`/${appId}`);
    } catch (requestError) {
      notifyRequestError(requestError, "删除表单失败", {
        description: "请确认后端服务正常。",
      });
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const availableIds = new Set(displayedRecords.map((record) => record.id));
      setSelectedRecordIds((current) =>
        retainAvailableSelection(current, availableIds),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [displayedRecords]);

  function toggleRecordSelection(recordId: string, selected: boolean) {
    setSelectedRecordIds((current) => {
      if (current.has(recordId) === selected) return current;
      const next = new Set(current);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  }

  function updatePageSelection(
    pageIds: string[],
    selectedPageIds: Set<string>,
  ) {
    setSelectedRecordIds((current) =>
      mergePageSelection(current, pageIds, selectedPageIds),
    );
  }

  function saveDraft() {
    persistDraft(drawerValues);
    setDrawerOpen(false);
    notify.success("草稿已暂存");
  }

  function openDraft(draft: RecordFormDraft) {
    setDrawerValues(draft.values);
    setDrawerResetKey((current) => current + 1);
    setIsDraftsOpen(false);
    setDrawerOpen(true);
  }

  function deleteDraft(draftId: string) {
    removeDraft(draftId);
  }

  function submitDrawerForm(mode: "submit" | "continue") {
    if (detailSourceFormUuid && !detailParentRecordUuid) {
      notify.error("请选择归属主记录");
      return;
    }
    drawerSubmitModeRef.current = mode;
    const form = document.getElementById(
      "create-record-form",
    ) as HTMLFormElement | null;
    form?.requestSubmit();
  }

  const { isImportOpen, setIsImportOpen, importState, setImportState, importFields, downloadExcelTemplate, exportSelectedRecords, openImportModal, handleImportFileChange, handleImportSheetChange, importExcelRows } = useRecordWorkbook({ schema, formMetadataName, formUuid, selectedRecordIds, displayedRecords, visibleFields, loadRecords, createRecord: (data) => recordMutations.create.mutateAsync(data) });

  if (systemPageTitle) {
    return (
      <SystemPageView
        appId={appId}
        pageSlug={formUuid}
        pageTitle={systemPageTitle}
      />
    );
  }

  if (!schema || recordsQuery.isPending) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在加载页面...
      </div>
    );
  }

  function activateTableView(view: FormView) {
    viewUrlTransitionRef.current = { viewUuid: view.viewUuid ?? null };
    setActiveViewId(view.id);
    setPendingViewConfig(null);
    setViewConfigDraft(null);
    if (embedded) {
      viewUrlTransitionRef.current = null;
      return;
    }
    const query = view.viewUuid
      ? `?viewUuid=${encodeURIComponent(view.viewUuid)}`
      : "";
    router.replace(`/${appId}/${formUuid}${query}`);
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 mb-2">
            {/* 表单标题以迁移到头部容器 */}
            {/* <h1 className="mr-1 min-w-0 truncate text-xl font-semibold text-[var(--color-text-primary)]">
              {formMetadataName || schema?.formName || "表单详情"}
            </h1> */}
            {canCreateRecord ? (
              <Button
                isIconOnly
                aria-label="新增"
                className="h-9 w-9 p-0"
                onClick={() => {
                  setDrawerValues({});
                  setDrawerResetKey((current) => current + 1);
                  setDrawerOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
            {canDeleteForm ? (
              <Button
                isIconOnly
                aria-label="删除"
                variant="danger"
                onClick={() => setDeleteOpen(true)}
                className="h-9 w-9 p-0"
              >
                <TrashBin className="h-4 w-4" />
              </Button>
            ) : null}
            {canImportRecords ? (
              <Button
                isIconOnly
                aria-label="导入"
                variant="secondary"
                onPress={openImportModal}
                className="h-9 w-9 p-0"
              >
                <ArrowUpFromLine className="h-4 w-4" />
              </Button>
            ) : null}
            {canExportRecords ? (
              <Button
                isIconOnly
                aria-label="导出"
                variant="secondary"
                onPress={() => void exportSelectedRecords()}
                className="h-9 w-9 p-0"
              >
                <ArrowDownToLine className="h-4 w-4" />
              </Button>
            ) : null}
            {canBulkDeleteRecords ? (
              <Button
                isIconOnly
                aria-label={`批量删除${selectedRecordIds.size ? `（${selectedRecordIds.size}）` : ""}`}
                variant="danger"
                isDisabled={selectedRecordIds.size === 0 || isBulkDeleting}
                onPress={() => setIsBulkDeleteOpen(true)}
                className="h-9 w-9 p-0"
              >
                <BroomMotion className="h-4 w-4" />
              </Button>
            ) : null}
            {canUseViewDevelopment ? (
              <Dropdown>
                <Dropdown.Trigger aria-label="更多">
                  <Ellipsis />
                </Dropdown.Trigger>
                <Dropdown.Popover>
                  <Dropdown.Menu aria-label="更多表格操作">
                    <Dropdown.Item
                      id="create-table-view"
                      onAction={handleCreateTableView}
                    >
                      新增表格视图
                    </Dropdown.Item>
                    <Dropdown.Item
                      id="drafts"
                      onAction={() => setIsDraftsOpen(true)}
                    >
                      <span className="flex w-full items-center justify-between gap-5">
                        草稿箱
                        <Badge
                          color="accent"
                          size="sm"
                          className="!static !translate-x-0 !translate-y-0"
                        >
                          {drafts.length}
                        </Badge>
                      </span>
                    </Dropdown.Item>
                    <Dropdown.Item
                      id="recycle-bin"
                      onAction={() =>
                        router.push(
                          `/recycle-bin?formUuid=${encodeURIComponent(formUuid)}`,
                        )
                      }
                    >
                      回收站
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            ) : null}
          </div>

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

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <FormViewTabs
              views={views}
              activeViewId={activeViewId}
              onActivate={(viewId) => {
                const view = views.find((item) => item.id === viewId);
                if (view) activateTableView(view);
              }}
            />
            {canUseViewDevelopment ? (
              <IconToolbarButton
                label="表格设置"
                onPress={() => openViewConfig("filters")}
              >
                <Sliders className="h-4 w-4" />
              </IconToolbarButton>
            ) : null}
            {canEditForm && !isDetailForm ? (
              <IconToolbarButton
                label="表单编辑"
                onPress={() =>
                  router.push(`/designer/${formUuid}?appId=${appId}`)
                }
              >
                <Pencil className="h-4 w-4" />
              </IconToolbarButton>
            ) : null}
            {canEditForm && !isDetailForm && subformFields.length > 0 ? (
              <IconToolbarButton
                label="创建明细表单"
                onPress={() => {
                  setDetailSubformId(availableDetailSubformFields[0]?.id ?? "");
                  setNewDetailPrimaryDisplayFieldId("instanceId");
                  setNewDetailSecondaryDisplayFieldId("submitter");
                  setDetailFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
              </IconToolbarButton>
            ) : null}
          </div>
        </div>
        <AlertDialog isOpen={isBulkDeleteOpen} onOpenChange={setIsBulkDeleteOpen}>
          <AlertDialog.Backdrop>
            <AlertDialog.Container>
              <AlertDialog.Dialog>
                <AlertDialog.Header>
                  <AlertDialog.Heading>批量删除</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  确认删除选中的 {selectedRecordIds.size} 条记录吗？删除后数据会移入回收站。
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button variant="secondary" isDisabled={isBulkDeleting} onPress={() => setIsBulkDeleteOpen(false)}>取消</Button>
                  <Button variant="danger" isDisabled={isBulkDeleting || selectedRecordIds.size === 0} onPress={() => void handleBulkDeleteRecords()}>
                    {isBulkDeleting ? "删除中…" : "确认删除"}
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {canUseViewDevelopment && viewConfigDirty ? (
            <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)] px-4 py-2 text-sm text-[var(--color-primary)]">
              <span>你调整了显示配置，是否需要保存配置？</span>
              <Button size="sm" onPress={saveViewConfig}>
                保存配置
              </Button>
            </div>
          ) : null}
          {isViewConfigReady ? (
            <RecordsTable
              readOnly={readOnly}
              customButtonViewUuid={
                formViews.activeFormView?.viewUuid ?? "default"
              }
              customButtonBindings={readOnly ? [] : effectiveViewConfig.customButtons ?? []}
              customButtonConfigDirty={viewConfigDirty}
              fields={configuredFields}
              builtinFields={configuredBuiltinFields}
              columnOrder={orderedViewFieldIds}
              frozenFieldIds={
                effectiveViewConfig.frozenFieldIds ?? EMPTY_FROZEN_FIELD_IDS
              }
              formType={formType}
              sortableFieldIds={sortableFieldIds}
              columnWidths={
                effectiveViewConfig.columnWidths ?? EMPTY_COLUMN_WIDTHS
              }
              sorts={effectiveViewConfig.sorts}
              formName={formMetadataName || schema.formName || formUuid}
              schema={schema}
              records={
                searchedRecords as Parameters<typeof RecordsTable>[0]["records"]
              }
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
              submitting={submitting}
              deletingRecordId={deletingRecordId}
              selectedRecordIds={selectedRecordIds}
              onDeleteRecord={handleDeleteRecord}
              onUpdateRecord={handleUpdateRecord}
              onWorkflowAction={handleWorkflowAction}
              onCompleteExecutionTask={handleCompleteExecutionTask}
              onRefreshRecords={loadRecords}
              canEditRecord={canEditRecord}
              canCreateRecord={canCreateRecord}
              isDetailForm={isDetailForm}
              canDeleteRecord={canDeleteRecord}
              urlParams={runtimeUrlParams}
              onRecordSelectionChange={toggleRecordSelection}
              onPageSelectionChange={updatePageSelection}
              onViewConfigChange={(patch) => {
                setRecordPage(1);
                setPendingViewConfig((current) => ({
                  ...(current ?? effectiveViewConfig),
                  ...patch,
                }));
              }}
              initialRecordId={searchParams.get("record") ?? undefined}
              initialPageMode={
                searchParams.get("buttonPageMode") === "edit" ? "edit" : "view"
              }
              initialTaskId={executionTaskId}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">
              正在加载视图配置...
            </div>
          )}
        </div>
      </div>

      <Modal.Backdrop
        isOpen={detailFormOpen}
        onOpenChange={setDetailFormOpen}
        className="theme-modal-backdrop"
        isDismissable
      >
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>创建明细表单</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="detail-subform-select">子表单</Label>
                <Select
                  id="detail-subform-select"
                  aria-label="子表单"
                  selectedKey={detailSubformId}
                  onSelectionChange={(key) =>
                    setDetailSubformId(String(key ?? ""))
                  }
                >
                  <Select.Trigger>
                    <Select.Value>
                      {availableDetailSubformFields.find(
                        (field) => field.id === detailSubformId,
                      )?.label ?? "选择子表单"}
                    </Select.Value>
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {availableDetailSubformFields.map((field) => (
                        <ListBox.Item key={field.id} id={field.id}>
                          {field.label}
                        </ListBox.Item>
                      ))}
                      {availableDetailSubformFields.length === 0 ? (
                        <ListBox.Item id="empty" isDisabled>
                          所有子表单均已生成明细表单
                        </ListBox.Item>
                      ) : null}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col space-y-2">
                  <Label>主显示字段</Label>
                  <DetailDisplayFieldSelect
                    ariaLabel="主显示字段"
                    options={detailDisplayFieldOptions}
                    selectedKey={newDetailPrimaryDisplayFieldId}
                    onSelectionChange={setNewDetailPrimaryDisplayFieldId}
                  />
                </div>
                <div className="flex flex-col space-y-2">
                  <Label>次级显示字段</Label>
                  <DetailDisplayFieldSelect
                    ariaLabel="次级显示字段"
                    options={detailDisplayFieldOptions.filter(
                      (field) => field.id !== newDetailPrimaryDisplayFieldId,
                    )}
                    selectedKey={newDetailSecondaryDisplayFieldId}
                    onSelectionChange={setNewDetailSecondaryDisplayFieldId}
                  />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="ghost"
                isDisabled={creatingDetailForm}
                onPress={() => setDetailFormOpen(false)}
              >
                取消
              </Button>
              <Button
                isDisabled={
                  creatingDetailForm ||
                  !detailSubformId ||
                  existingDetailSubformIds.has(detailSubformId)
                }
                onPress={() => void handleCreateDetailForm()}
              >
                {creatingDetailForm ? "创建中..." : "确定"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Drawer.Backdrop
        isOpen={drawerOpen}
        onOpenChange={setDrawerOpen}
        className="theme-modal-backdrop"
        isDismissable
      >
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[1200px]">
            <Drawer.Header>
              <div className="flex w-full items-center justify-between gap-4">
                <div>
                  <Drawer.Heading>新增数据</Drawer.Heading>
                </div>
              </div>
            </Drawer.Header>
            <Drawer.Body className="flex-1 overflow-y-auto">
              <div className="contents">
                <div className="contents">
                  {detailSourceFormUuid ? (
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                          归属主记录
                        </div>
                        <div className="mt-0.5 truncate text-sm text-[var(--color-text-primary)]">
                          {detailParentRecordUuid
                            ? getDetailParentRecordLabel(
                                detailParentRecords.find(
                                  (record) =>
                                    record.id === detailParentRecordUuid,
                                ),
                                detailPrimaryDisplayFieldId,
                                detailSecondaryDisplayFieldId,
                                detailParentRecordUuid,
                              )
                            : "请选择此明细数据归属的主记录"}
                        </div>
                      </div>
                      <Dropdown>
                        <Dropdown.Trigger
                          aria-label="选择归属主记录"
                          className="inline-flex h-8 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 text-xs text-[var(--color-text-primary)]"
                        >
                          选择记录
                        </Dropdown.Trigger>
                        <Dropdown.Popover>
                          <Dropdown.Menu aria-label="选择归属主记录">
                            {detailParentRecords.map((record) => (
                              <Dropdown.Item
                                key={record.id}
                                id={record.id}
                                onAction={() =>
                                  setDetailParentRecordUuid(record.id)
                                }
                              >
                                {getDetailParentRecordLabel(
                                  record,
                                  detailPrimaryDisplayFieldId,
                                  detailSecondaryDisplayFieldId,
                                )}
                              </Dropdown.Item>
                            ))}
                            {detailParentRecords.length === 0 ? (
                              <Dropdown.Item id="empty" isDisabled>
                                暂无可选主记录
                              </Dropdown.Item>
                            ) : null}
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    </div>
                  ) : null}
                  <RuntimeFormSurface>
                    <RuntimeFormPanel
                      key={drawerResetKey}
                      formId="create-record-form"
                      schema={schema}
                      initialValues={drawerValues}
                      showSubmitButton={false}
                      submitLabel={submitButtonText}
                      submitting={submitting}
                      urlParams={runtimeUrlParams}
                      onValuesChange={setDrawerValues}
                      onSubmit={(values) =>
                        handleCreateRecord(
                          values,
                          drawerSubmitModeRef.current === "continue"
                            ? "drawerContinue"
                            : "drawer",
                        )
                      }
                    />
                  </RuntimeFormSurface>
                </div>
              </div>
            </Drawer.Body>
            <Drawer.Footer className="flex shrink-0 justify-between gap-3">
              <Button
                variant="ghost"
                isDisabled={submitting}
                onPress={() => setDrawerOpen(false)}
              >
                取消
              </Button>
              <ButtonGroup>
                <Button
                  variant="secondary"
                  isDisabled={submitting}
                  onPress={saveDraft}
                >
                  暂存
                </Button>

                <Button
                  variant="secondary"
                  isDisabled={
                    submitting ||
                    Boolean(detailSourceFormUuid && !detailParentRecordUuid)
                  }
                  onPress={() => submitDrawerForm("continue")}
                >
                  提交并继续
                </Button>
                <Button
                  isDisabled={
                    submitting ||
                    Boolean(detailSourceFormUuid && !detailParentRecordUuid)
                  }
                  onPress={() => submitDrawerForm("submit")}
                >
                  {submitting ? "提交中..." : "提交"}
                </Button>
              </ButtonGroup>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

      <Modal.Backdrop
        isOpen={isDraftsOpen}
        onOpenChange={setIsDraftsOpen}
        className="theme-modal-backdrop"
        isDismissable
      >
        <Modal.Container placement="center" scroll="inside" size="lg">
          <Modal.Dialog className="theme-menu-surface flex max-h-[80vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-dialog)]">
            <Modal.Header>
              <Modal.Heading>草稿箱</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭草稿箱" />
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center justify-between gap-4 border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--color-text-primary)]">
                      {formMetadataName || schema.formName || "表单"}草稿
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      暂存于 {formatDateTime(draft.savedAt)} · 已填写{" "}
                      {
                        Object.values(draft.values).filter(
                          (value) =>
                            value !== "" &&
                            value !== undefined &&
                            value !== null,
                        ).length
                      }{" "}
                      项
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[var(--color-danger)]"
                      onPress={() => deleteDraft(draft.id)}
                    >
                      删除
                    </Button>
                    <Button size="sm" onPress={() => openDraft(draft)}>
                      继续编辑
                    </Button>
                  </div>
                </div>
              ))}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {(
        <FormTableSetting
          appId={appId}
          viewName={formViews.activeFormView?.name ?? ""}
          savedViewName={formViews.activeFormView?.name ?? ""}
          isDefaultView={!formViews.activeFormView || formViews.activeFormView.isDefault}
          isManagingView={formViews.isRenamingView || formViews.isDeletingView}
          onSaveViewName={formViews.renameActiveView}
          onDeleteView={() => {
            if (formViews.activeFormView) formViews.deleteView(formViews.activeFormView.id);
          }}
          formUuid={formUuid}
          isOpen={viewConfigMode !== null}
          mode={viewConfigMode}
          initialDraft={viewConfigDraft}
          onOpenChange={(open) => {
            if (!open) closeViewConfig();
          }}
          onSectionChange={setViewConfigMode}
          onClose={closeViewConfig}
          onApply={applyViewConfigDraft}
          allFields={allViewFields.map((field) => ({
            id: field.id,
            label: field.label,
            type: field.type,
            typeLabel: getViewFieldTypeLabel(field.type),
          }))}
          queryableFields={queryableViewFields.map((field) => ({
            id: field.id,
            label: field.label,
            type: field.type,
            typeLabel: getViewFieldTypeLabel(field.type),
          }))}
          orderedFields={orderedDraftViewFields}
          sensors={viewFieldOrderSensors}
        />
      )}

      <FormDataImportDrawer
        isOpen={isImportOpen}
        onOpenChange={(open) => {
          if (!importState.importing) setIsImportOpen(open);
        }}
        state={importState}
        setState={setImportState}
        fields={importFields}
        builtinFieldLabels={BUILTIN_RECORD_FIELD_LABELS}
        onDownloadTemplate={downloadExcelTemplate}
        onFileChange={handleImportFileChange}
        onSheetChange={handleImportSheetChange}
        onImport={importExcelRows}
      />

      <AlertDialog.Backdrop
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        className="theme-modal-backdrop"
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>删除表单</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="">
              删除后，表单设计、提交记录和导航项都会被移除。
            </AlertDialog.Body>
            <AlertDialog.Footer className="">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                取消
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteForm}
                isDisabled={deleting}
              >
                {deleting ? "删除中..." : "确认删除"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop
        isOpen={viewDeleteTarget !== null}
        onOpenChange={(isOpen) => !isOpen && !formViews.isDeletingView && setViewDeleteTarget(null)}
        className="theme-modal-backdrop"
      >
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>删除视图</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="">
              {viewDeleteTarget
                ? `确认删除视图“${viewDeleteTarget.name}”吗？此操作无法恢复。`
                : ""}
            </AlertDialog.Body>
            <AlertDialog.Footer className="">
              <Button
                variant="ghost"
                onPress={() => setViewDeleteTarget(null)}
                isDisabled={formViews.isDeletingView}
              >
                取消
              </Button>
              <Button
                variant="danger"
                isDisabled={viewDeleteTarget === null || formViews.isDeletingView}
                onPress={handleConfirmDeleteView}
              >
                {formViews.isDeletingView ? "删除中..." : "确认删除"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

function toSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value)) return value.map(toSearchText).join(" ");
  if (typeof value === "object")
    return Object.values(value).map(toSearchText).join(" ");
  return "";
}
