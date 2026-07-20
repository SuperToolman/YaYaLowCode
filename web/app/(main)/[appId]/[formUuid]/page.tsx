"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Table,
  Tabs,
  TextArea,
  toast,
} from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Card } from "@heroui/react/card";
import { Modal } from "@heroui/react/modal";
import { Pagination } from "@heroui/react/pagination";
import {
  ArrowDownToLine,
  ArrowChevronLeft,
  ArrowChevronRight,
  ArrowChevronDown,
  ArrowUpArrowDown,
  ArrowUpFromLine,
  ArrowsExpand,
  Copy,
  Ellipsis,
  Eye,
  Funnel,
  Pencil,
  FaceRobot,
  PaperPlane,
  Plus,
  Sliders,
  TrashBin,
  Xmark,
} from "@gravity-ui/icons";
import {
  RuntimeFormRenderer,
  type RuntimeFormSchema,
  type RuntimeSchemaField,
} from "../../../components/runtime-form-renderer";
import { AgentMarkdown } from "../../../components/agent-markdown";
import { getSystemPageBySlug, isSystemPageSlug } from "../../../lib/system-pages";
import { getFormComponentAgentCapability } from "../../../lib/form-component-agent-capabilities";

type SchemaField = RuntimeSchemaField;
type FormSchema = RuntimeFormSchema;

type NavigationItem = {
  itemType: string;
  targetFormUuid?: string | null;
  title: string;
  pathSlug: string;
};

type ApiEnvelope<T> = {
  code: number;
  data: T | null;
  message: string;
  time: string;
};

type FormRecord = {
  id: string;
  formUuid: string;
  schemaVersion: number;
  data: Record<string, unknown>;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

type RecordTableRow = FormRecord & {
  rowNumber: number;
  displayValues: {
    fields: Record<string, string>;
    builtIns: Record<string, string>;
  };
};

type FormRecordList = {
  items: FormRecord[];
  total: number;
};

type FormMetadata = {
  id: string;
  name: string;
};

type ViewKey = "records" | "submit";
type ViewFilterOperator = "contains" | "equals" | "notEquals" | "greaterThan" | "lessThan";
type ViewFilterRule = { id: string; fieldId: string; operator: ViewFilterOperator; value: string };
type ViewSortRule = { id: string; fieldId: string; direction: "asc" | "desc" };
type ViewConfig = { visibleFieldIds: string[]; filters: ViewFilterRule[]; sorts: ViewSortRule[] };
type FormView = { id: string; viewUuid?: string; name: string; isDefault: boolean; config: ViewConfig; updatedAt: string };

type FormAgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type FormAgentSession = {
  id: string;
};

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

const BUILTIN_RECORD_FIELD_LABELS = new Set<string>(
  BUILTIN_RECORD_FIELDS.map((field) => field.label),
);

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

export default function FormHome({
  params,
}: {
  params: Promise<{ appId: string; formUuid: string }>;
}) {
  const { appId, formUuid } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [formMetadataName, setFormMetadataName] = useState("");
  const [systemPageTitle, setSystemPageTitle] = useState<string | null>(
    isSystemPageSlug(formUuid) ? (getSystemPageBySlug(formUuid)?.title ?? null) : null,
  );
  const [records, setRecords] = useState<FormRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerValues, setDrawerValues] = useState<Record<string, unknown>>({});
  const [drawerResetKey, setDrawerResetKey] = useState(0);
  const drawerSubmitModeRef = useRef<"submit" | "continue">("submit");
  const [drafts, setDrafts] = useState<FormDraft[]>([]);
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importState, setImportState] = useState<ImportWorkbookState>(
    EMPTY_IMPORT_STATE,
  );
  const [submitterOrganizations, setSubmitterOrganizations] = useState<
    Record<string, string>
  >({});
  const [agentDraftValues, setAgentDraftValues] = useState<Record<string, unknown>>({});
  const [agentValuePatch, setAgentValuePatch] = useState<{ id: number; values: Record<string, unknown> }>();
  const [views, setViews] = useState<FormView[]>([]);
  const [activeViewId, setActiveViewId] = useState("default");
  const [viewConfigMode, setViewConfigMode] = useState<"filters" | "fields" | "sorts" | null>(null);
  const [viewConfigDraft, setViewConfigDraft] = useState<ViewConfig | null>(null);
  const [pendingViewConfig, setPendingViewConfig] = useState<ViewConfig | null>(null);
  const [openViewMenuId, setOpenViewMenuId] = useState<string | null>(null);
  const [viewDeleteTarget, setViewDeleteTarget] = useState<FormView | null>(null);
  const viewMenuCloseTimerRef = useRef<number | null>(null);
  const viewUrlTransitionRef = useRef<{ viewUuid: string | null } | null>(null);

  const activeView: ViewKey = searchParams.get("view") === "submit" ? "submit" : "records";
  const submitButtonText = schema?.pageProps?.submitButtonText?.trim() || "提交";
  const agentConfig = schema?.pageProps?.agent;
  const agentEnabled = Boolean(agentConfig?.enabled);
  const visibleFields = useMemo(
    () => getVisibleDataFields(schema?.fields ?? []),
    [schema?.fields],
  );
  const allViewFields = useMemo(
    () => [...visibleFields.map((field) => ({ id: field.id, label: field.label })), ...BUILTIN_RECORD_FIELDS],
    [visibleFields],
  );
  const defaultViewConfig = useMemo<ViewConfig>(() => ({
    visibleFieldIds: allViewFields.map((field) => field.id),
    filters: [],
    sorts: [],
  }), [allViewFields]);
  const activeFormView = views.find((view) => view.id === activeViewId) ?? views[0];
  const effectiveViewConfig = pendingViewConfig ?? activeFormView?.config ?? defaultViewConfig;
  const configuredFields = useMemo(
    () => visibleFields.filter((field) => effectiveViewConfig.visibleFieldIds.includes(field.id)),
    [effectiveViewConfig.visibleFieldIds, visibleFields],
  );
  const configuredBuiltinFields = useMemo(
    () => BUILTIN_RECORD_FIELDS.filter((field) => effectiveViewConfig.visibleFieldIds.includes(field.id)),
    [effectiveViewConfig.visibleFieldIds],
  );
  const displayedRecords = useMemo(() => applyViewConfig(records, effectiveViewConfig, formMetadataName || schema?.formName || formUuid, submitterOrganizations), [effectiveViewConfig, formMetadataName, formUuid, records, schema?.formName, submitterOrganizations]);
  const viewConfigDirty = Boolean(pendingViewConfig && JSON.stringify(pendingViewConfig) !== JSON.stringify(activeFormView?.config ?? defaultViewConfig));

  useEffect(() => {
    if (!visibleFields.length) return;
    const timer = window.setTimeout(() => {
      const stored = readFormViews(formUuid, defaultViewConfig);
      setViews(stored);
      setActiveViewId((current) => stored.some((view) => view.id === current) ? current : stored[0]?.id ?? "default");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultViewConfig, formUuid, visibleFields.length]);

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
  }, [activeView, activeViewId, searchParams, views]);

  function openViewConfig(mode: "filters" | "fields" | "sorts") {
    setViewConfigDraft(JSON.parse(JSON.stringify(effectiveViewConfig)) as ViewConfig);
    setViewConfigMode(mode);
  }

  function saveViewConfig() {
    if (!pendingViewConfig || !activeFormView) return;
    const nextViews = views.map((view) => view.id === activeFormView.id ? { ...view, config: pendingViewConfig, updatedAt: new Date().toISOString() } : view);
    setViews(nextViews);
    writeFormViews(formUuid, nextViews);
    setPendingViewConfig(null);
    setViewConfigDraft(null);
    toast.success("视图配置已保存");
  }

  function applyViewConfigDraft() {
    if (!viewConfigDraft) return;
    setPendingViewConfig(JSON.parse(JSON.stringify(viewConfigDraft)) as ViewConfig);
    setViewConfigDraft(null);
    setViewConfigMode(null);
  }

  function createTableView() {
    const viewUuid = createViewUuid();
    const nextView: FormView = { id: `view-${viewUuid}`, viewUuid, name: "未命名表格视图", isDefault: false, config: defaultViewConfig, updatedAt: new Date().toISOString() };
    const nextViews = [...views, nextView];
    setViews(nextViews);
    activateTableView(nextView);
    writeFormViews(formUuid, nextViews);
  }

  function deleteView(viewId: string) {
    const view = views.find((item) => item.id === viewId);
    if (!view || view.isDefault) return;
    setViewDeleteTarget(view);
  }

  function confirmDeleteView() {
    if (!viewDeleteTarget) return;
    const nextViews = views.filter((item) => item.id !== viewDeleteTarget.id);
    setViews(nextViews);
    activateTableView(nextViews.find((item) => item.isDefault) ?? { id: "default", name: "全部数据", isDefault: true, config: defaultViewConfig, updatedAt: new Date().toISOString() });
    setViewDeleteTarget(null);
    writeFormViews(formUuid, nextViews);
  }

  function duplicateView(viewId: string) {
    const source = views.find((view) => view.id === viewId);
    if (!source) return;
    const viewUuid = createViewUuid();
    const copy: FormView = { ...source, id: `view-${viewUuid}`, viewUuid, name: `${source.name} 副本`, isDefault: false, config: JSON.parse(JSON.stringify(source.config)) as ViewConfig, updatedAt: new Date().toISOString() };
    const nextViews = [...views, copy];
    setViews(nextViews);
    activateTableView(copy);
    writeFormViews(formUuid, nextViews);
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
    if (isSystemPageSlug(formUuid)) {
      return;
    }

    setLoadingRecords(true);

    try {
      const response = await fetch(`/api/forms/${formUuid}/records`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiEnvelope<FormRecordList>;

      if (payload.code === 0 && payload.data) {
        setRecords(payload.data.items);
      }
    } finally {
      setLoadingRecords(false);
    }
  }, [formUuid]);

  useEffect(() => {
    let cancelled = false;

    async function loadSchema() {
      const fallbackSystemPage = getSystemPageBySlug(formUuid);

      if (fallbackSystemPage) {
        setSystemPageTitle(fallbackSystemPage.title);
        return;
      }

      try {
        const navigationResponse = await fetch(`/api/apps/${appId}/navigation`, {
          cache: "no-store",
        });
        const navigationPayload = (await navigationResponse.json()) as ApiEnvelope<
          NavigationItem[]
        >;

        if (!cancelled && navigationPayload.code === 0 && navigationPayload.data) {
          const matchedItem = navigationPayload.data.find(
            (item) => item.pathSlug === formUuid || item.targetFormUuid === formUuid,
          );

          if (matchedItem?.itemType === "system") {
            setSystemPageTitle(matchedItem.title);
            return;
          }
        }

        const [metadataResponse, response] = await Promise.all([
          fetch(`/api/forms/${formUuid}`, { cache: "no-store" }),
          fetch(`/api/forms/${formUuid}/schema?scope=published`, { cache: "no-store" }),
        ]);
        const metadataPayload = (await metadataResponse.json()) as ApiEnvelope<FormMetadata>;
        const payload = (await response.json()) as ApiEnvelope<{
          schema: FormSchema;
        }>;

        if (!cancelled && metadataPayload.code === 0 && metadataPayload.data) {
          setFormMetadataName(metadataPayload.data.name);
        }
        if (!cancelled && payload.code === 0 && payload.data?.schema) {
          setSystemPageTitle(null);
          setSchema(payload.data.schema);
        }
      } catch {
        // Keep local fallback schema for static demo forms.
      }
    }

    void loadSchema();

    return () => {
      cancelled = true;
    };
  }, [appId, formUuid]);

  useEffect(() => {
    if (isSystemPageSlug(formUuid)) return;
    let cancelled = false;
    void fetch("/api/identity/users", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: ApiEnvelope<Array<{ displayName: string; primaryDepartment: string | null }>>) => {
        if (cancelled || payload.code !== 0 || !payload.data) return;
        setSubmitterOrganizations(
          Object.fromEntries(
            payload.data.map((user) => [user.displayName, user.primaryDepartment || "-"]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [formUuid]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRecords();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadRecords]);

  async function handleCreateRecord(
    values: Record<string, unknown>,
    source: "drawer" | "drawerContinue" | "page",
  ) {
    setSubmitting(true);

    try {
      const response = await fetch(`/api/forms/${formUuid}/records`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          data: values,
          operator: "管理员",
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<FormRecord>;

      if (payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "submit failed");
      }

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
    } catch {
      toast.danger("提交失败", {
        description: "请确认后端服务正常。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRecord(
    recordId: string,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    setSubmitting(true);

    try {
      const response = await fetch(`/api/forms/${formUuid}/records/${recordId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          data: values,
          operator: "管理员",
        }),
      });
      const payload = (await response.json()) as ApiEnvelope<FormRecord>;

      if (payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "update failed");
      }

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

  async function handleDeleteRecord(recordId: string): Promise<boolean> {
    setDeletingRecordId(recordId);

    try {
      const response = await fetch(`/api/forms/${formUuid}/records/${recordId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as ApiEnvelope<Record<string, unknown>>;

      if (payload.code !== 0) {
        throw new Error(payload.message || "delete failed");
      }

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
      const response = await fetch(`/api/forms/${formUuid}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as ApiEnvelope<Record<string, unknown>>;

      if (payload.code !== 0) {
        throw new Error(payload.message || "delete failed");
      }

      setDeleteOpen(false);
      toast.success("表单已删除", {
        description: `表单 ${formUuid} 已移除`,
      });
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
      const availableIds = new Set(records.map((record) => record.id));
      setSelectedRecordIds((current) => {
        const next = new Set([...current].filter((recordId) => availableIds.has(recordId)));
        return next.size === current.size ? current : next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [records]);

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
    drawerSubmitModeRef.current = mode;
    const form = document.getElementById("create-record-form") as HTMLFormElement | null;
    form?.requestSubmit();
  }

  async function downloadExcelTemplate() {
    const XLSX = await import("xlsx");
    const columns = buildExcelColumns(excelFields);
    const headers = [
      ...columns.map((column) => column.header),
      ...BUILTIN_RECORD_FIELDS.map((field) => field.label),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    worksheet["!cols"] = headers.map(() => ({ wch: 22 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "数据");
    XLSX.writeFile(workbook, `${sanitizeFileName(formMetadataName || schema?.formName || formUuid)}-导入模板.xlsx`, { compression: true });
  }

  async function exportSelectedRecords() {
    if (selectedRecordIds.size === 0) {
      toast.warning("请选择需要导出的数据", {
        description: "在数据行上悬停并勾选复选框后再导出。",
      });
      return;
    }

    const selectedRecords = records.filter((record) => selectedRecordIds.has(record.id));
    const columns = buildExcelColumns(excelFields);
    const resolvedFormName = formMetadataName || schema?.formName || formUuid;
    const XLSX = await import("xlsx");
    const matrix = [
      [
        ...columns.map((column) => column.header),
        ...BUILTIN_RECORD_FIELDS.map((field) => field.label),
      ],
      ...selectedRecords.map((record) => {
        const builtIns = getBuiltinRecordValues(record, resolvedFormName, submitterOrganizations);
        return [
          ...columns.map((column) => serializeExcelValue(record.data[column.field.id])),
          ...BUILTIN_RECORD_FIELDS.map((field) => builtIns[field.id]),
        ];
      }),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix);
    worksheet["!cols"] = matrix[0].map(() => ({ wch: 22 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "数据");
    XLSX.writeFile(
      workbook,
      `${sanitizeFileName(formMetadataName || schema?.formName || formUuid)}-数据-${selectedRecords.length}条.xlsx`,
      { compression: true },
    );
  }

  function openImportModal() {
    setImportStep(1);
    setImportState(EMPTY_IMPORT_STATE);
    setIsImportOpen(true);
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = sheetName ? workbook.Sheets[sheetName] : null;
      if (!worksheet) throw new Error("Excel 文件中没有可读取的工作表");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: false,
      }) as unknown[][];
      const headers = (matrix[0] ?? []).map((cell) => String(cell).trim());
      const rows = matrix.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
      if (headers.length === 0) throw new Error("Excel 第一行必须包含字段标题");
      const excelColumns = buildExcelColumns(excelFields);
      const mappings = Object.fromEntries(
        headers.map((header, index) => {
          const matched = excelColumns.find(
            (column) => column.header === header || column.field.label === header || column.field.id === header,
          );
          return [index, matched?.field.id ?? ""];
        }),
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
    setImportStep(3);
    setImportState((current) => ({ ...current, importing: true, completed: false, progress: 0, successCount: 0, failureCount: 0 }));
    let successCount = 0;
    let failureCount = 0;
    const fieldMap = new Map(excelFields.map((field) => [field.id, field]));

    for (let index = 0; index < importState.rows.length; index += 1) {
      const row = importState.rows[index];
      const data: Record<string, unknown> = {};
      for (const [columnIndexText, fieldId] of Object.entries(importState.mappings)) {
        if (!fieldId) continue;
        const field = fieldMap.get(fieldId);
        if (!field) continue;
        const value = deserializeExcelValue(field, row[Number(columnIndexText)]);
        if (value !== undefined) data[fieldId] = value;
      }
      try {
        const response = await fetch(`/api/forms/${formUuid}/records`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data, operator: "管理员" }),
        });
        const payload = (await response.json()) as ApiEnvelope<FormRecord>;
        if (!response.ok || payload.code !== 0) throw new Error(payload.message || "导入失败");
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
              <Button
                isIconOnly
                aria-label="新增"
                className="h-9 w-9 rounded-lg bg-[var(--color-primary)] p-0 text-[var(--color-text-on-primary)]"
                onClick={() => { setDrawerValues({}); setAgentDraftValues({}); setAgentValuePatch(undefined); setDrawerResetKey((current) => current + 1); setDrawerOpen(true); }}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                isIconOnly
                aria-label="删除"
                variant="ghost"
                onClick={() => setDeleteOpen(true)}
                className="h-9 w-9 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] p-0 text-[var(--color-danger)]"
              >
                <TrashBin className="h-4 w-4" />
              </Button>
              <Button
                isIconOnly
                aria-label="导入"
                variant="ghost"
                onPress={openImportModal}
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <ArrowUpFromLine className="h-4 w-4" />
              </Button>
              <Button
                isIconOnly
                aria-label="导出"
                variant="ghost"
                onPress={() => void exportSelectedRecords()}
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <ArrowDownToLine className="h-4 w-4" />
              </Button>
            <Dropdown>
                <Dropdown.Trigger
                  aria-label="更多"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-primary)]"
                >
                  <Ellipsis className="h-4 w-4" />
                </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="更多表格操作">
                  <Dropdown.Item id="create-table-view" onAction={createTableView}>
                    新增表格视图
                  </Dropdown.Item>
                  <Dropdown.Item id="drafts" onAction={() => setIsDraftsOpen(true)}>
                    <span className="flex w-full items-center justify-between gap-5">
                      草稿箱
                      <Badge color="accent" size="sm" className="!static !translate-x-0 !translate-y-0">{drafts.length}</Badge>
                    </span>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
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
                <Dropdown isOpen={openViewMenuId === view.id} onOpenChange={(open) => setOpenViewMenuId(open ? view.id : null)}>
                  <Dropdown.Trigger onMouseEnter={() => openViewMenu(view.id)} onMouseLeave={scheduleViewMenuClose} aria-label={`${view.name}视图菜单`} className="inline-flex h-9 w-7 items-center justify-center bg-transparent">
                    <ArrowChevronDown className="h-3.5 w-3.5" />
                  </Dropdown.Trigger>
                  <Dropdown.Popover onMouseEnter={() => openViewMenu(view.id)} onMouseLeave={scheduleViewMenuClose}><Dropdown.Menu aria-label={`${view.name}操作`}>
                    <Dropdown.Item id="settings" isDisabled>表格设置（开发中）</Dropdown.Item>
                    <Dropdown.Item id="hide" isDisabled>隐藏（开发中）</Dropdown.Item>
                    <Dropdown.Item id="copy" onAction={() => duplicateView(view.id)}>复制</Dropdown.Item>
                    <Dropdown.Item id="delete" onAction={() => deleteView(view.id)}>删除</Dropdown.Item>
                  </Dropdown.Menu></Dropdown.Popover>
                </Dropdown>
              </div>
            ))}
            <ViewTab
              isActive={activeView === "submit"}
              label="表单提交"
              onClick={() => { setPendingViewConfig(null); setViewConfigDraft(null); handleViewChange("submit"); }}
            />
            <IconToolbarButton label="筛选" onPress={() => openViewConfig("filters")}><Funnel className="h-4 w-4" /></IconToolbarButton>
            <IconToolbarButton label="显示列" onPress={() => openViewConfig("fields")}><Sliders className="h-4 w-4" /></IconToolbarButton>
            <IconToolbarButton label="排序" onPress={() => openViewConfig("sorts")}><ArrowUpArrowDown className="h-4 w-4" /></IconToolbarButton>
            <IconToolbarButton label="表单编辑" onPress={() => router.push(`/designer/${formUuid}?appId=${appId}`)}><Pencil className="h-4 w-4" /></IconToolbarButton>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {activeView === "records" ? (
            <>
            {viewConfigDirty ? <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary-soft)] px-4 py-2 text-sm text-[var(--color-primary)]"><span>你调整了显示配置，是否需要保存配置？</span><Button size="sm" onPress={saveViewConfig}>保存配置</Button></div> : null}
            <RecordsTable
              fields={configuredFields}
              builtinFields={configuredBuiltinFields}
              formName={formMetadataName || schema.formName || formUuid}
              schema={schema}
              records={displayedRecords.filter((record) => JSON.stringify(record.data).toLowerCase().includes(searchValue.trim().toLowerCase()))}
              loading={loadingRecords}
              submitting={submitting}
              deletingRecordId={deletingRecordId}
              selectedRecordIds={selectedRecordIds}
              submitterOrganizations={submitterOrganizations}
              onDeleteRecord={handleDeleteRecord}
              onUpdateRecord={handleUpdateRecord}
              urlParams={{ appId, formUuid }}
              onRecordSelectionChange={toggleRecordSelection}
            />
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RuntimeFormPanel
                schema={schema}
                submitLabel={submitButtonText}
                submitting={submitting}
                urlParams={{ appId, formUuid }}
                onSubmit={(values) => handleCreateRecord(values, "page")}
              />
            </div>
          )}
        </div>
      </Card>

      <Modal isOpen={drawerOpen} onOpenChange={setDrawerOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" scroll="inside" size="cover">
            <Modal.Dialog className={`theme-menu-surface flex h-[90vh] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-dialog)] ${agentEnabled ? "w-[90vw] max-w-[90vw]" : "w-[80vw] max-w-[80vw]"}`}>
              <Modal.Header className="border-b border-[var(--color-border)] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                      新增数据
                    </Modal.Heading>
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
              </Modal.Header>
              <Modal.Body className={agentEnabled ? "min-h-0 flex-1 overflow-hidden p-0" : "flex-1 overflow-y-auto px-6 py-6"}>
                <div className={agentEnabled ? "flex h-full min-h-0" : "contents"}>
                  <div className={agentEnabled ? "min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6" : "contents"}>
                    <RuntimeFormPanel
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
                    />
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
              </Modal.Body>
              <Modal.Footer className="flex shrink-0 justify-between gap-3 border-t border-[var(--color-border)] px-6 py-4">
                <Button variant="ghost" isDisabled={submitting} onPress={saveDraft}>暂存</Button>
                <div className="flex items-center gap-3">
                  <Button variant="ghost" isDisabled={submitting} onPress={() => setDrawerOpen(false)}>取消</Button>
                  <Button variant="secondary" isDisabled={submitting} onPress={() => submitDrawerForm("continue")}>提交并继续</Button>
                  <Button isDisabled={submitting} onPress={() => submitDrawerForm("submit")}>{submitting ? "提交中..." : "提交"}</Button>
                </div>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

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

      <Modal isOpen={viewConfigMode !== null} onOpenChange={(open) => { if (!open) { setViewConfigDraft(null); setViewConfigMode(null); } }}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" scroll="inside" size="lg">
            <Modal.Dialog className="theme-menu-surface flex max-h-[82vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {viewConfigMode === "filters" ? "筛选" : viewConfigMode === "fields" ? "显示列" : "排序"}
                </Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭配置" />
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {viewConfigDraft && viewConfigMode === "filters" ? (
                  <div className="space-y-3">
                    {viewConfigDraft.filters.map((rule) => (
                      <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_36px] items-center gap-2">
                        <Select selectedKey={rule.fieldId} aria-label="筛选字段" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.map((item) => item.id === rule.id ? { ...item, fieldId: String(key ?? "") } : item) } : current)}>
                          <Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox>{allViewFields.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover>
                        </Select>
                        <Select selectedKey={rule.operator} aria-label="筛选条件" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.map((item) => item.id === rule.id ? { ...item, operator: String(key) as ViewFilterOperator } : item) } : current)}>
                          <Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="contains">包含</ListBox.Item><ListBox.Item id="equals">等于</ListBox.Item><ListBox.Item id="notEquals">不等于</ListBox.Item><ListBox.Item id="greaterThan">大于</ListBox.Item><ListBox.Item id="lessThan">小于</ListBox.Item></ListBox></Select.Popover>
                        </Select>
                        <Input aria-label="筛选值" value={rule.value} placeholder="请输入值" onChange={(event) => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.map((item) => item.id === rule.id ? { ...item, value: event.target.value } : item) } : current)} />
                        <Button isIconOnly variant="ghost" aria-label="删除筛选条件" onPress={() => setViewConfigDraft((current) => current ? { ...current, filters: current.filters.filter((item) => item.id !== rule.id) } : current)}><TrashBin className="h-4 w-4" /></Button>
                      </div>
                    ))}
                    <Button variant="ghost" className="text-[var(--color-primary)]" onPress={() => setViewConfigDraft((current) => current ? { ...current, filters: [...current.filters, { id: `filter-${Date.now()}`, fieldId: allViewFields[0]?.id ?? "", operator: "contains", value: "" }] } : current)}>+ 添加筛选条件</Button>
                  </div>
                ) : null}
                {viewConfigDraft && viewConfigMode === "fields" ? (
                  <div className="space-y-2">
                    <div className="mb-3 text-sm text-[var(--color-text-secondary)]">选择需要在当前视图中显示的字段</div>
                    {allViewFields.map((field) => <label key={field.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"><Checkbox isSelected={viewConfigDraft.visibleFieldIds.includes(field.id)} onChange={(selected) => setViewConfigDraft((current) => current ? { ...current, visibleFieldIds: selected ? [...current.visibleFieldIds, field.id] : current.visibleFieldIds.filter((id) => id !== field.id) } : current)}><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox><span>{field.label}</span></label>)}
                  </div>
                ) : null}
                {viewConfigDraft && viewConfigMode === "sorts" ? (
                  <div className="space-y-3">
                    {viewConfigDraft.sorts.map((rule) => <div key={rule.id} className="grid grid-cols-[minmax(0,1fr)_130px_36px] items-center gap-2"><Select selectedKey={rule.fieldId} aria-label="排序字段" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, sorts: current.sorts.map((item) => item.id === rule.id ? { ...item, fieldId: String(key ?? "") } : item) } : current)}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox>{allViewFields.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover></Select><Select selectedKey={rule.direction} aria-label="排序方向" onSelectionChange={(key) => setViewConfigDraft((current) => current ? { ...current, sorts: current.sorts.map((item) => item.id === rule.id ? { ...item, direction: String(key) as "asc" | "desc" } : item) } : current)}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="asc">升序</ListBox.Item><ListBox.Item id="desc">降序</ListBox.Item></ListBox></Select.Popover></Select><Button isIconOnly variant="ghost" aria-label="删除排序规则" onPress={() => setViewConfigDraft((current) => current ? { ...current, sorts: current.sorts.filter((item) => item.id !== rule.id) } : current)}><TrashBin className="h-4 w-4" /></Button></div>)}
                    <Button variant="ghost" className="text-[var(--color-primary)]" onPress={() => setViewConfigDraft((current) => current ? { ...current, sorts: [...current.sorts, { id: `sort-${Date.now()}`, fieldId: allViewFields[0]?.id ?? "", direction: "asc" }] } : current)}>+ 添加排序规则</Button>
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-4"><Button variant="ghost" onPress={() => { setViewConfigDraft(null); setViewConfigMode(null); }}>取消</Button><Button onPress={applyViewConfigDraft}>应用调整</Button></Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal
        isOpen={isImportOpen}
        onOpenChange={(open) => {
          if (!importState.importing) setIsImportOpen(open);
        }}
      >
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable={!importState.importing}>
          <Modal.Container placement="center" scroll="inside" size="cover">
            <Modal.Dialog className="theme-menu-surface flex max-h-[86vh] w-[min(1550px,calc(100vw-48px))] max-w-[1550px] flex-col rounded-2xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-6 py-4">
                <div className="w-full">
                  <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                    导入表单数据
                  </Modal.Heading>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      { step: 1, label: "上传 Excel" },
                      { step: 2, label: "导入设置" },
                      { step: 3, label: "导入数据" },
                    ].map((item) => (
                      <div
                        key={item.step}
                        className={[
                          "rounded-lg border px-3 py-2 text-center text-xs font-medium",
                          importStep === item.step
                            ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                            : importStep > item.step
                              ? "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]"
                              : "border-[var(--color-border)] text-[var(--color-text-secondary)]",
                        ].join(" ")}
                      >
                        {item.step}. {item.label}
                      </div>
                    ))}
                  </div>
                </div>
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {importStep === 1 ? (
                  <div className="space-y-5">
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">下载导入模板</div>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                        模板与导出文件使用相同字段和列顺序。请保留第一行标题。
                      </p>
                      <Button variant="secondary" className="mt-3" onPress={() => void downloadExcelTemplate()}>
                        <ArrowDownToLine className="h-4 w-4" />
                        下载 Excel 模板
                      </Button>
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">上传填写后的 Excel</div>
                      <Input
                        key={importState.fileName || "empty-import-file"}
                        fullWidth
                        type="file"
                        accept=".xlsx,.xls"
                        aria-label="上传导入 Excel"
                        onChange={handleImportFileChange}
                      />
                      {importState.fileName ? (
                        <div className="mt-3 rounded-lg border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">
                          已读取 {importState.fileName}，共 {importState.rows.length} 条数据、{importState.headers.length} 列
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {importStep === 2 ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">匹配导入字段</div>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                        左侧为 Excel 列，右侧选择写入的表单字段。不需要导入的列可设为忽略。
                      </p>
                    </div>
                    {importState.headers.map((header, columnIndex) => (
                      <div key={`${header}-${columnIndex}`} className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-[var(--color-text-primary)]">{header || `未命名列 ${columnIndex + 1}`}</div>
                          {BUILTIN_RECORD_FIELD_LABELS.has(header) ? <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">系统字段，导入时自动生成</div> : null}
                        </div>
                        <span className="text-center text-[var(--color-text-disabled)]">→</span>
                        <Select
                          aria-label={`匹配 ${header || `第 ${columnIndex + 1} 列`}`}
                          isDisabled={BUILTIN_RECORD_FIELD_LABELS.has(header)}
                          selectedKey={importState.mappings[columnIndex] || "__ignore__"}
                          onSelectionChange={(key) =>
                            setImportState((current) => ({
                              ...current,
                              mappings: {
                                ...current.mappings,
                                [columnIndex]: key === "__ignore__" || key === null ? "" : String(key),
                              },
                            }))
                          }
                        >
                          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="__ignore__" textValue="忽略此列">忽略此列</ListBox.Item>
                              {excelFields.map((field) => (
                                <ListBox.Item key={field.id} id={field.id} textValue={field.label}>
                                  {field.label}
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>
                    ))}
                  </div>
                ) : null}

                {importStep === 3 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center text-center">
                    <div className="w-full max-w-lg">
                      <div className="text-base font-semibold text-[var(--color-text-primary)]">
                        {importState.completed ? "导入完成" : "正在导入数据"}
                      </div>
                      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                        {importState.completed
                          ? `成功 ${importState.successCount} 条，失败 ${importState.failureCount} 条`
                          : `正在逐条写入，共 ${importState.rows.length} 条数据`}
                      </p>
                      <ProgressBar aria-label="导入进度" value={importState.progress} className="mt-5">
                        <div className="mb-2 flex justify-between text-xs text-[var(--color-text-secondary)]">
                          <span>{importState.successCount} 条成功</span>
                          <ProgressBar.Output>{importState.progress}%</ProgressBar.Output>
                        </div>
                        <ProgressBar.Track>
                          <ProgressBar.Fill />
                        </ProgressBar.Track>
                      </ProgressBar>
                      {importState.failureCount > 0 ? (
                        <p className="mt-3 text-xs text-[var(--color-danger)]">有 {importState.failureCount} 条数据导入失败。</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="flex justify-between border-t border-[var(--color-border)] px-6 py-4">
                <Button
                  variant="ghost"
                  isDisabled={importState.importing}
                  onPress={() => {
                    if (importStep === 1 || importState.completed) setIsImportOpen(false);
                    else setImportStep((current) => (current === 3 ? 2 : 1));
                  }}
                >
                  {importStep === 1 || importState.completed ? "关闭" : "上一步"}
                </Button>
                {importStep === 1 ? (
                  <Button isDisabled={importState.rows.length === 0} onPress={() => setImportStep(2)}>
                    下一步
                  </Button>
                ) : null}
                {importStep === 2 ? (
                  <Button
                    isDisabled={!Object.values(importState.mappings).some(Boolean) || importState.rows.length === 0}
                    onPress={() => void importExcelRows()}
                  >
                    开始导入
                  </Button>
                ) : null}
                {importStep === 3 && !importState.completed ? (
                  <Button isDisabled>导入中…</Button>
                ) : null}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

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
                  onPress={confirmDeleteView}
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

function FormAgentPanel({ agentId, analysis, appId, currentValues, fields, formName, formUuid, onApplyValues, prompt }: { agentId: string; analysis: string; appId: string; currentValues: Record<string, unknown>; fields: SchemaField[]; formName: string; formUuid: string; onApplyValues: (values: Record<string, unknown>) => void; prompt: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<FormAgentMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [error, messages, streaming]);

  const context = { appId, formUuid, formDraftAssist: true, route: `/${appId}/${formUuid}` };

  async function createSession() {
    if (!agentId) throw new Error("当前表单尚未选择机器人");
    const response = await fetch("/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, context }),
    });
    const payload = (await response.json()) as ApiEnvelope<FormAgentSession>;
    if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "无法创建 Agent 会话");
    setSessionId(payload.data.id);
    return payload.data.id;
  }

  async function sendMessage(content = input) {
    const normalized = content.trim();
    if (!normalized || streaming) return;
    setInput("");
    setError("");
    setStreaming(true);
    sequence.current += 1;
    const messageId = sequence.current;
    const assistantId = `form-agent-assistant-${messageId}`;
    setMessages((current) => [...current, { id: `form-agent-user-${messageId}`, role: "user", content: normalized }, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const activeSessionId = sessionId ?? await createSession();
      const writableFields = fields.filter((field) => {
        const capability = getFormComponentAgentCapability(field.type);
        return capability.writable && !field.props?.isHidden && !field.props?.isDisabled && !field.props?.isReadOnly && field.props?.defaultValueType !== "formula";
      });
      const fieldContext = writableFields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        options: field.props?.options,
        agentCapability: getFormComponentAgentCapability(field.type),
      }));
      const businessContext = [
        `当前业务表单：${formName}（${formUuid}）`,
        prompt.trim() ? `表单业务说明：${prompt.trim()}` : "",
        analysis.trim() ? `发布前 Schema 分析结果：${analysis.trim()}` : "",
        `可填写字段：${JSON.stringify(fieldContext)}`,
        `当前未提交表单值：${JSON.stringify(currentValues)}`,
        "如果用户要求填写表单，请直接生成合适的字段值，不要先要求分析表单，也不要提交数据。请在正常回复末尾追加一个不可见标记，严格格式为：<!--FORM_VALUES:{\"字段ID\":\"字段值\"}-->。只包含需要填写或修改的字段。",
        `用户请求：${normalized}`,
      ].filter(Boolean).join("\n\n");
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(activeSessionId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ content: businessContext, context }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json()) as ApiEnvelope<never>;
        throw new Error(payload.message || "Agent 请求失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        frames.forEach((frame) => { assistantContent += applyFormAgentFrame(frame, assistantId, setMessages); });
        if (done) {
          if (buffer.trim()) assistantContent += applyFormAgentFrame(buffer, assistantId, setMessages);
          break;
        }
      }
      const valuePatch = extractFormValuePatch(assistantContent, writableFields);
      if (Object.keys(valuePatch).length > 0) {
        onApplyValues(valuePatch);
        toast.success("Agent 已填写表单", { description: `已更新 ${Object.keys(valuePatch).length} 个字段，尚未提交。` });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Agent 请求失败";
      setError(message);
      setMessages((current) => current.map((item) => item.id === assistantId && !item.content ? { ...item, content: `Agent 运行失败：${message}` } : item));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-[420px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-control-soft)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-4 w-4" /></span>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">表单 Agent</div><div className="truncate text-xs text-[var(--color-text-secondary)]">协助处理 {formName}</div></div>
        </div>
      </div>
      <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]"><FaceRobot className="h-5 w-5" /></span>
            <p className="mt-3 text-sm font-medium">让 Agent 协助处理表单业务</p>
            <p className="mt-2 max-w-xs text-xs leading-5 text-[var(--color-text-secondary)]">直接描述业务需求，例如“帮我填写这份申请表，但先不要提交”。</p>
          </div>
        ) : messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={message.role === "user" ? "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--color-primary-soft)] px-3 py-2 text-sm leading-6" : "w-full px-1 py-1 text-sm leading-7"}>
              {message.content ? (message.role === "assistant" ? <AgentMarkdown content={message.content} /> : message.content) : (streaming ? "正在思考…" : "")}
            </div>
          </div>
        ))}
        {error ? <p className="rounded-lg bg-[var(--color-danger-soft)] p-3 text-xs text-[var(--color-danger)]">{error}</p> : null}
      </div>
      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex items-end gap-2">
          <TextArea
            fullWidth
            rows={2}
            aria-label="向表单 Agent 提问"
            placeholder={agentId ? "描述需要 Agent 处理的业务…" : "请先在设计器中选择机器人"}
            value={input}
            disabled={!agentId || streaming}
            className="h-[58px] min-h-[58px] max-h-[58px] resize-none overflow-y-auto text-sm leading-5"
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <Button isIconOnly aria-label="发送消息" isDisabled={!agentId || !input.trim() || streaming} onPress={() => void sendMessage()}><PaperPlane className="h-4 w-4" /></Button>
        </div>
      </div>
    </aside>
  );
}

function applyFormAgentFrame(frame: string, assistantId: string, setMessages: Dispatch<SetStateAction<FormAgentMessage[]>>) {
  let eventName = "message";
  const dataLines: string[] = [];
  frame.split("\n").forEach((line) => {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  });
  if (dataLines.length === 0) return "";
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>; } catch { return ""; }
  if (eventName === "message.delta" && typeof payload.delta === "string") {
    setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + payload.delta } : message));
    return payload.delta;
  }
  if ((eventName === "run.failed" || eventName === "message.failed") && typeof payload.message === "string") {
    setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: `Agent 运行失败：${payload.message}` } : message));
  }
  return "";
}

function extractFormValuePatch(content: string, writableFields: SchemaField[]) {
  const match = content.match(/<!--FORM_VALUES:([\s\S]*?)-->/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const fieldMap = new Map(writableFields.map((field) => [field.id, field]));
    const entries: Array<[string, unknown]> = [];
    for (const [fieldId, value] of Object.entries(parsed)) {
      const field = fieldMap.get(fieldId);
      if (!field) continue;
      const normalized = normalizeAgentFieldValue(field, value);
      if (normalized.accepted) entries.push([fieldId, normalized.value]);
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function normalizeAgentFieldValue(field: SchemaField, value: unknown): { accepted: boolean; value: unknown } {
  const capability = getFormComponentAgentCapability(field.type);
  if (!capability.writable) return { accepted: false, value: undefined };
  const optionValues = new Set((field.props?.options ?? []).map((option) => option.value));

  if (capability.valueType === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numberValue)) return { accepted: false, value: undefined };
    if (typeof field.props?.minValue === "number" && numberValue < field.props.minValue) return { accepted: false, value: undefined };
    if (typeof field.props?.maxValue === "number" && numberValue > field.props.maxValue) return { accepted: false, value: undefined };
    return { accepted: true, value: numberValue };
  }

  if (capability.valueType === "string[]") {
    if (!Array.isArray(value)) return { accepted: false, value: undefined };
    const values = value.filter((item): item is string => typeof item === "string");
    if (values.length !== value.length) return { accepted: false, value: undefined };
    if (optionValues.size > 0 && values.some((item) => !optionValues.has(item))) return { accepted: false, value: undefined };
    return { accepted: true, value: values };
  }

  if (capability.valueType === "dateRange") {
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item))) return { accepted: false, value: undefined };
    return { accepted: true, value };
  }

  if (capability.valueType === "date") {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? { accepted: true, value }
      : { accepted: false, value: undefined };
  }

  if (capability.valueType === "string") {
    if (typeof value !== "string") return { accepted: false, value: undefined };
    if (optionValues.size > 0 && !optionValues.has(value)) return { accepted: false, value: undefined };
    return { accepted: true, value };
  }

  if (capability.valueType === "boolean" && typeof value === "boolean") return { accepted: true, value };
  return { accepted: false, value: undefined };
}

function RuntimeFormPanel({
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
}

function RecordsTable({
  builtinFields,
  deletingRecordId,
  fields,
  formName,
  schema,
  records,
  selectedRecordIds,
  submitterOrganizations,
  loading,
  submitting,
  onDeleteRecord,
  onUpdateRecord,
  urlParams,
  onRecordSelectionChange,
}: {
  builtinFields: readonly { id: string; label: string }[];
  deletingRecordId: string | null;
  fields: SchemaField[];
  formName: string;
  schema: FormSchema;
  records: FormRecord[];
  selectedRecordIds: Set<string>;
  submitterOrganizations: Record<string, string>;
  loading: boolean;
  submitting: boolean;
  onDeleteRecord: (recordId: string) => Promise<boolean>;
  onUpdateRecord: (recordId: string, values: Record<string, unknown>) => Promise<boolean>;
  urlParams: Record<string, string>;
  onRecordSelectionChange: (recordId: string, selected: boolean) => void;
}) {
  const pageSizeOptions = [10, 20, 30, 40, 50];
  const columns = useMemo(() => fields.slice(0, 6), [fields]);
  const [detailRecord, setDetailRecord] = useState<FormRecord | null>(null);
  const [isDetailEditing, setIsDetailEditing] = useState(false);
  const [detailTab, setDetailTab] = useState<"comments" | "history">("comments");
  const [isDetailFullscreen, setIsDetailFullscreen] = useState(false);
  const [deleteRecordTarget, setDeleteRecordTarget] = useState<FormRecord | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortDescriptor, setSortDescriptor] = useState<{ column: string; direction: "ascending" | "descending" }>({
    column: "createdAt",
    direction: "descending",
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const recordDisplayValues = useMemo(() => {
    const values = new Map<string, {
      fields: Record<string, string>;
      builtIns: Record<string, string>;
    }>();

    records.forEach((record) => {
      values.set(record.id, {
        fields: Object.fromEntries(columns.map((field) => [field.id, formatRecordValue(record.data[field.id])])),
        builtIns: getBuiltinRecordValues(record, formName, submitterOrganizations),
      });
    });

    return values;
  }, [columns, formName, records, submitterOrganizations]);
  const businessColumnWidths = useMemo(
    () => columns.map((field) => estimateTableColumnWidth([
      field.label,
      ...records.map((record) => recordDisplayValues.get(record.id)?.fields[field.id] ?? ""),
    ])),
    [columns, recordDisplayValues, records],
  );
  const builtInColumnWidths = useMemo(
    () => builtinFields.map((field) => estimateTableColumnWidth([
      field.label,
      ...records.map((record) => recordDisplayValues.get(record.id)?.builtIns[field.id] ?? ""),
    ], 0, field.id === "instanceTitle" ? 360 : 260)),
    [builtinFields, recordDisplayValues, records],
  );
  const sortedRecords = useMemo(() => {
    const direction = sortDescriptor.direction === "ascending" ? 1 : -1;
    const getSortValue = (record: FormRecord) => {
      const values = recordDisplayValues.get(record.id);
      return values?.fields[sortDescriptor.column] ?? values?.builtIns[sortDescriptor.column] ?? "";
    };
    return [...records].sort((left, right) => direction * getSortValue(left).localeCompare(
      getSortValue(right),
      undefined,
      { numeric: true, sensitivity: "base" },
    ));
  }, [recordDisplayValues, records, sortDescriptor]);
  const pageCount = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const pageStart = (activePage - 1) * pageSize;
  const pageRecords = sortedRecords.slice(pageStart, pageStart + pageSize);
  const tableRows = useMemo<RecordTableRow[]>(
    () => pageRecords.map((record, index) => ({
      ...record,
      rowNumber: pageStart + index + 1,
      displayValues: recordDisplayValues.get(record.id)!,
    })),
    [pageRecords, pageStart, recordDisplayValues],
  );
  const allCurrentPageSelected = pageRecords.length > 0 && pageRecords.every((record) => selectedRecordIds.has(record.id));
  const someCurrentPageSelected = pageRecords.some((record) => selectedRecordIds.has(record.id));
  const getColumnWidth = useCallback((columnId: string, fallback: number) => columnWidths[columnId] ?? fallback, [columnWidths]);
  const startColumnResize = useCallback((columnId: string, startX: number, startWidth: number, maxWidth: number) => {
    const handlePointerMove = (event: PointerEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [columnId]: Math.min(maxWidth, Math.max(24, startWidth + event.clientX - startX)),
      }));
    };
    const stop = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stop, { once: true });
  }, []);
  const tableWidth = useMemo(() => (
    20 + 180
    + columns.reduce((total, field, index) => total + getColumnWidth(field.id, businessColumnWidths[index]), 0)
    + builtinFields.reduce((total, field, index) => total + getColumnWidth(field.id, builtInColumnWidths[index]), 0)
  ), [builtInColumnWidths, builtinFields, businessColumnWidths, columns, getColumnWidth]);
  const paginationPages = getPaginationPageNumbers(activePage, pageCount);
  const detailRecordIndex = detailRecord
    ? records.findIndex((record) => record.id === detailRecord.id)
    : -1;
  const detailBuiltIns = detailRecord
    ? getBuiltinRecordValues(detailRecord, formName, submitterOrganizations)
    : null;

  function openDetail(record: FormRecord, editing = false) {
    setDetailRecord(record);
    setIsDetailEditing(editing);
    setDetailTab("comments");
    setIsDetailFullscreen(false);
  }

  function showAdjacentRecord(direction: -1 | 1) {
    const nextRecord = records[detailRecordIndex + direction];
    if (nextRecord) openDetail(nextRecord);
  }

  function toggleCurrentPageSelection(selected: boolean) {
    pageRecords.forEach((record) => onRecordSelectionChange(record.id, selected));
  }

  async function copyDetailRecord() {
    if (!detailRecord) return;
    await navigator.clipboard?.writeText(JSON.stringify(detailRecord.data, null, 2));
    toast.success("记录数据已复制");
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
    <div className="theme-card-glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
      <Table variant="secondary" className="records-table min-h-0 flex-1">
        <Table.ScrollContainer className="data-table-horizontal-scroll h-full overflow-auto">
          <Table.Content aria-label="表单提交数据" className="table-fixed border-separate border-spacing-0 text-left text-[12px] text-[var(--color-text-primary)]" style={{ width: tableWidth, minWidth: "100%" }}>
            <Table.Header className="text-[12px] font-medium text-[var(--color-text-secondary)]">
              <Table.Column id="selection" isRowHeader style={{ width: 20 }} className="sticky top-0 z-20 h-10 border-b border-r border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-center">
                <TableSelectionCheckbox ariaLabel="全选当前页" isSelected={allCurrentPageSelected} isIndeterminate={someCurrentPageSelected && !allCurrentPageSelected} onChange={toggleCurrentPageSelection} />
              </Table.Column>
              {columns.map((field, index) => {
                const width = getColumnWidth(field.id, businessColumnWidths[index]);
                return (
                  <Table.Column key={field.id} id={field.id} style={{ width }} className="relative sticky top-0 z-20 h-10 border-b border-r border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0">
                    <button type="button" onClick={() => setSortDescriptor((current) => ({ column: field.id, direction: current.column === field.id && current.direction === "ascending" ? "descending" : "ascending" }))} className="flex h-full min-w-0 w-full items-center gap-1 px-1 pr-4 text-left hover:text-[var(--color-text-primary)]">
                      <span className="truncate whitespace-nowrap">{field.label}</span><ArrowUpArrowDown className={sortDescriptor.column === field.id ? "h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" : "h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)]"} />
                    </button>
                    <div role="separator" aria-label={`调整${field.label}列宽`} onPointerDown={(event) => { event.preventDefault(); startColumnResize(field.id, event.clientX, width, 320); }} className="absolute right-0 top-1/2 z-40 h-6 w-px -translate-y-1/2 cursor-col-resize bg-[var(--color-border)] hover:w-0.5 hover:bg-[var(--color-primary)]" />
                  </Table.Column>
                );
              })}
              {builtinFields.map((field, index) => {
                const maxWidth = field.id === "instanceTitle" ? 360 : 260;
                const width = getColumnWidth(field.id, builtInColumnWidths[index]);
                return (
                  <Table.Column key={field.id} id={field.id} style={{ width }} className="relative sticky top-0 z-20 h-10 border-b border-r border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0">
                    <button type="button" onClick={() => setSortDescriptor((current) => ({ column: field.id, direction: current.column === field.id && current.direction === "ascending" ? "descending" : "ascending" }))} className="flex h-full min-w-0 w-full items-center gap-1 px-1 pr-4 text-left hover:text-[var(--color-text-primary)]">
                      <span className="truncate whitespace-nowrap">{field.label}</span><ArrowUpArrowDown className={sortDescriptor.column === field.id ? "h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" : "h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)]"} />
                    </button>
                    <div role="separator" aria-label={`调整${field.label}列宽`} onPointerDown={(event) => { event.preventDefault(); startColumnResize(field.id, event.clientX, width, maxWidth); }} className="absolute right-0 top-1/2 z-40 h-6 w-px -translate-y-1/2 cursor-col-resize bg-[var(--color-border)] hover:w-0.5 hover:bg-[var(--color-primary)]" />
                  </Table.Column>
                );
              })}
              <Table.Column id="actions" style={{ width: 180 }} className="sticky top-0 right-0 z-30 h-10 border-b border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] px-1 shadow-[-6px_0_8px_-8px_var(--color-text-secondary)]">操作</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={() => <div className="flex min-h-64 flex-col items-center justify-center px-4 py-12 text-center"><div className="text-base font-medium text-[var(--color-text-primary)]">暂无数据</div><div className="mt-2 text-sm text-[var(--color-text-secondary)]">当前表单还没有提交记录，可以先通过“新增”填写一条数据。</div></div>}>
              <Table.Collection items={tableRows}>
                {(record) => (
                  <Table.Row key={record.id} className="group">
                    <Table.Cell className="relative h-10 border-b border-[var(--color-border)] p-0 text-center text-[var(--color-text-secondary)]">
                      <span className={selectedRecordIds.has(record.id) ? "opacity-0" : "transition-opacity group-hover:opacity-0"}>{record.rowNumber}</span>
                      <TableSelectionCheckbox ariaLabel={`选择第 ${record.rowNumber} 行`} isSelected={selectedRecordIds.has(record.id)} onChange={(selected) => onRecordSelectionChange(record.id, selected)} className={["absolute inset-0 z-20 flex items-center justify-center", selectedRecordIds.has(record.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"].join(" ")} />
                    </Table.Cell>
                    {columns.map((field) => <Table.Cell key={field.id} className="h-10 border-b border-[var(--color-border)] px-1"><span className="block truncate" title={record.displayValues.fields[field.id]}>{record.displayValues.fields[field.id]}</span></Table.Cell>)}
                    {builtinFields.map((field) => <Table.Cell key={field.id} className="h-10 border-b border-[var(--color-border)] px-1"><span className="block truncate" title={record.displayValues.builtIns[field.id]}>{record.displayValues.builtIns[field.id]}</span></Table.Cell>)}
                    <Table.Cell className="records-table__action-cell sticky right-0 z-10 h-10 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-1 shadow-[-6px_0_8px_-8px_var(--color-text-secondary)]">
                      <div className="relative z-20 flex w-max items-center gap-1.5">
                        <Button type="button" variant="ghost" className="h-8 gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-text-primary)]" onClick={() => openDetail(record)}><Eye className="h-3.5 w-3.5" />查看</Button>
                        <Button type="button" variant="ghost" className="h-8 gap-1 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-danger)]" isDisabled={deletingRecordId === record.id} onClick={() => setDeleteRecordTarget(record)}><TrashBin className="h-3.5 w-3.5" />{deletingRecordId === record.id ? "删除中..." : "删除"}</Button>
                        <details className="relative"><summary aria-label={`记录 ${record.rowNumber} 更多操作`} className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)] [&::-webkit-details-marker]:hidden"><Ellipsis className="h-3.5 w-3.5" /></summary><div className="absolute right-0 z-50 mt-1 min-w-28 overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-menu)] py-1 shadow-[var(--shadow-floating)]"><button type="button" className="block w-full px-3 py-2 text-left text-xs hover:bg-[var(--color-bg-panel-soft)]" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(record.data, null, 2))}>复制数据</button><button type="button" disabled className="block w-full cursor-not-allowed px-3 py-2 text-left text-xs text-[var(--color-text-disabled)]">发起流程（开发中）</button></div></details>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="flex shrink-0 flex-nowrap items-center justify-between gap-4 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3">
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
      </div>
    </div>
    <Modal
      isOpen={detailRecord !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setDetailRecord(null);
          setIsDetailEditing(false);
          setIsDetailFullscreen(false);
        }
      }}
    >
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="cover" className={isDetailFullscreen ? "!inset-0 !h-[100dvh] !w-screen !max-w-none !p-0" : undefined}>
          <Modal.Dialog className={`flex flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)] ${isDetailFullscreen ? "fixed inset-0 h-[100dvh] w-screen max-h-none max-w-none rounded-none" : "h-[min(860px,88vh)] w-[min(1180px,94vw)] rounded-2xl"}`}>
            <Modal.Header className="flex-col items-stretch gap-4 border-b border-[var(--color-border)] px-6 py-4">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="min-w-0">
                  <Modal.Heading className="truncate text-lg font-semibold">{isDetailEditing ? "编辑数据" : detailBuiltIns?.instanceTitle ?? formName}</Modal.Heading>
                  <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{formName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button isIconOnly variant="ghost" aria-label={isDetailFullscreen ? "退出全屏" : "全屏查看"} className="h-8 w-8" onPress={() => setIsDetailFullscreen((current) => !current)}><ArrowsExpand className="h-4 w-4" /></Button>
                  {detailRecordIndex > 0 ? <Button isIconOnly variant="ghost" aria-label="上一条数据" className="h-8 w-8" onPress={() => showAdjacentRecord(-1)}><ArrowChevronLeft className="h-4 w-4" /></Button> : <Button isIconOnly variant="ghost" aria-label="上一条数据" className="h-8 w-8" isDisabled><ArrowChevronLeft className="h-4 w-4" /></Button>}
                  {detailRecordIndex >= 0 && detailRecordIndex < records.length - 1 ? <Button isIconOnly variant="ghost" aria-label="下一条数据" className="h-8 w-8" onPress={() => showAdjacentRecord(1)}><ArrowChevronRight className="h-4 w-4" /></Button> : <Button isIconOnly variant="ghost" aria-label="下一条数据" className="h-8 w-8" isDisabled><ArrowChevronRight className="h-4 w-4" /></Button>}
                  <Button isIconOnly variant="ghost" aria-label="复制该数据" className="h-8 w-8" onPress={() => void copyDetailRecord()}><Copy className="h-4 w-4" /></Button>
                  <Dropdown><Dropdown.Trigger aria-label="更多详情操作" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)]"><Ellipsis className="h-4 w-4" /></Dropdown.Trigger><Dropdown.Popover><Dropdown.Menu aria-label="更多详情操作"><Dropdown.Item id="copy-json" onAction={() => void copyDetailRecord()}>复制 JSON</Dropdown.Item><Dropdown.Item id="record-id" isDisabled>记录 ID：{detailRecord?.id ?? "-"}</Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown>
                  <Modal.CloseTrigger aria-label="关闭详情"><Xmark className="h-4 w-4" /></Modal.CloseTrigger>
                </div>
              </div>
              {detailBuiltIns ? <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--color-border)] pt-4 text-sm md:grid-cols-4"><DetailBuiltIn label="提交时间" value={detailBuiltIns.createdAt} /><DetailBuiltIn label="发起人" value={detailBuiltIns.submitter} /><DetailBuiltIn label="发起人组织" value={detailBuiltIns.submitterOrganization} /><DetailBuiltIn label="实例 ID" value={detailBuiltIns.instanceId} /></div> : null}
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {detailRecord ? (
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
                  onSubmit={async (values) => {
                    if (!isDetailEditing) return;
                    const updated = await onUpdateRecord(detailRecord.id, values);
                    if (updated) {
                      setDetailRecord(null);
                      setIsDetailEditing(false);
                    }
                  }}
                />
              ) : null}
              {detailRecord && !isDetailEditing ? <DetailAuxiliaryPanel activeTab={detailTab} record={detailRecord} onTabChange={setDetailTab} /> : null}
            </Modal.Body>
            <Modal.Footer className="flex shrink-0 justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4">
              {isDetailEditing ? (
                <Button variant="ghost" isDisabled={submitting} onPress={() => setIsDetailEditing(false)}>取消编辑</Button>
              ) : null}
              <Button
                variant="ghost"
                className="border border-[var(--color-danger)]/30 text-[var(--color-danger)]"
                isDisabled={!detailRecord || deletingRecordId === detailRecord?.id}
                onPress={() => detailRecord && setDeleteRecordTarget(detailRecord)}
              >
                {deletingRecordId === detailRecord?.id ? "删除中..." : "删除"}
              </Button>
              <Button
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

function DetailBuiltIn({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-[var(--color-text-primary)]" title={value}>{value}</div>
    </div>
  );
}

function TableSelectionCheckbox({
  ariaLabel,
  isSelected,
  isIndeterminate = false,
  onChange,
  className,
}: {
  ariaLabel: string;
  isSelected: boolean;
  isIndeterminate?: boolean;
  onChange: (selected: boolean) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = isIndeterminate;
  }, [isIndeterminate]);

  return (
    <label className={className ?? "inline-flex items-center justify-center"}>
      <input
        ref={inputRef}
        type="checkbox"
        aria-label={ariaLabel}
        checked={isSelected}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.checked)}
        className="relative z-30 h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
      />
    </label>
  );
}

function getPaginationPageNumbers(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", pageCount];
  }

  if (currentPage >= pageCount - 3) {
    return [1, "ellipsis", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", pageCount];
}

function DetailAuxiliaryPanel({
  activeTab,
  record,
  onTabChange,
}: {
  activeTab: "comments" | "history";
  record: FormRecord;
  onTabChange: (tab: "comments" | "history") => void;
}) {
  const hasUpdated = record.updatedAt !== record.createdAt;
  const changes = [
    { id: "created", type: "创建", actor: record.createdBy, text: `${record.createdBy} 创建记录`, time: record.createdAt },
    ...(hasUpdated ? [{ id: "updated", type: "更新", actor: record.updatedBy, text: `${record.updatedBy} 更新记录`, time: record.updatedAt }] : []),
  ];

  return (
    <section className="mt-8 border-t border-[var(--color-border)] pt-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">其它</h3>
      <Tabs
        variant="secondary"
        selectedKey={activeTab}
        onSelectionChange={(key) => onTabChange(key as "comments" | "history")}
        className="mt-4"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="详情辅助信息">
            <Tabs.Tab id="comments" className="px-4 py-2 text-sm">评论<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="history" className="px-4 py-2 text-sm">变更记录<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="comments" className="outline-none">
          <div className="py-5">
          <TextArea aria-label="评论" placeholder="请输入评论" disabled className="max-w-2xl" />
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">评论将在用户系统接入后启用。</p>
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="history" className="outline-none">
          <ol className="space-y-4 py-5">
          {changes.map((change) => (
            <li key={change.id} className="grid grid-cols-[10px_minmax(0,1fr)] gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium text-[var(--color-text-primary)]">{change.text}</span>
                  <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">{change.type}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-secondary)]">变更人：{change.actor} · {formatDateTime(change.time)}</div>
              </div>
            </li>
          ))}
          </ol>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}

function SystemPageView({
  appId,
  pageSlug,
  pageTitle,
}: {
  appId: string;
  pageSlug: string;
  pageTitle: string;
}) {
  const rows = buildSystemRows(appId, pageSlug);

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="shadow-[var(--shadow-designer)]">
        <Card className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">{pageTitle}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              应用 {appId} 的内置工作台页面，当前路由为 {pageSlug}。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              aria-label={`${pageTitle}搜索`}
              className="w-full min-w-[220px] md:w-[280px]"
              placeholder="搜索标题、流程或发起人"
            />
            <Button className="bg-[var(--color-primary)] text-[var(--color-text-on-primary)]">筛选</Button>
          </div>
        </Card>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
          <div className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px] gap-4 bg-[var(--color-bg-panel-soft)] px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)]">
            <span>标题</span>
            <span>状态</span>
            <span>发起人</span>
            <span>更新时间</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px] gap-4 border-t border-[var(--color-border)] px-4 py-4 text-sm text-[var(--color-text-primary)]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--color-text-primary)]">{row.title}</div>
                <div className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{row.description}</div>
              </div>
              <span>{row.status}</span>
              <span>{row.owner}</span>
              <span>{row.updatedAt}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildSystemRows(appId: string, pageSlug: string) {
  const pageTitle = getSystemPageBySlug(pageSlug)?.title ?? pageSlug;

  return Array.from({ length: 5 }, (_, index) => ({
    id: `${pageSlug}-${index + 1}`,
    title: `${pageTitle}事项 ${index + 1}`,
    description: `来自应用 ${appId} 的内置页面示例数据，后续可替换为真实待办查询。`,
    status: index % 2 === 0 ? "处理中" : "待确认",
    owner: ["张三", "李四", "王五", "赵六", "陈七"][index] ?? "系统",
    updatedAt: `2026-06-${String(index + 10).padStart(2, "0")} 09:30`,
  }));
}

function getVisibleDataFields(fields: SchemaField[]) {
  return fields.filter(
    (field) =>
      !field.props?.isHidden &&
      field.type !== "description" &&
      field.type !== "groupContainer" &&
      field.type !== "button" &&
      field.type !== "link",
  );
}

function formatRecordValue(value: unknown) {
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

function serializeExcelValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

function deserializeExcelValue(field: SchemaField, cell: unknown) {
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

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "表单";
}

function getFormDraftStorageKey(formUuid: string) {
  return `yaya-low-code:form-drafts:${formUuid}`;
}

function readFormDrafts(formUuid: string): FormDraft[] {
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

function writeFormDrafts(formUuid: string, drafts: FormDraft[]) {
  window.localStorage.setItem(getFormDraftStorageKey(formUuid), JSON.stringify(drafts));
}

function getFormViewStorageKey(formUuid: string) {
  return `yaya-low-code:form-views:${formUuid}`;
}

function createViewUuid() {
  const randomUuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `VIEW-${randomUuid.toUpperCase()}`;
}

function readFormViews(formUuid: string, defaultConfig: ViewConfig): FormView[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getFormViewStorageKey(formUuid)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [{ id: "default", name: "全部数据", isDefault: true, config: defaultConfig, updatedAt: new Date().toISOString() }];
    const valid = parsed.filter((view): view is FormView => Boolean(view && typeof view === "object" && "id" in view && "name" in view && "config" in view));
    const defaultView = valid.find((view) => view.id === "default") ?? { id: "default", name: "全部数据", isDefault: true, config: defaultConfig, updatedAt: new Date().toISOString() };
    let didMigrate = false;
    const migratedViews = valid
      .filter((view) => view.id !== "default")
      .map((view) => {
        if (view.viewUuid) return view;
        didMigrate = true;
        return { ...view, viewUuid: createViewUuid() };
      });
    const result = [{ ...defaultView, isDefault: true, viewUuid: undefined }, ...migratedViews];
    if (didMigrate) {
      writeFormViews(formUuid, result);
    }
    return result;
  } catch {
    return [{ id: "default", name: "全部数据", isDefault: true, config: defaultConfig, updatedAt: new Date().toISOString() }];
  }
}

function writeFormViews(formUuid: string, views: FormView[]) {
  window.localStorage.setItem(getFormViewStorageKey(formUuid), JSON.stringify(views));
}

function getViewFieldValue(record: FormRecord, fieldId: string, formName: string, submitterOrganizations: Record<string, string>) {
  if (fieldId in record.data) return formatRecordValue(record.data[fieldId]);
  return getBuiltinRecordValues(record, formName, submitterOrganizations)[fieldId] ?? "";
}

function applyViewConfig(records: FormRecord[], config: ViewConfig, formName: string, submitterOrganizations: Record<string, string>) {
  const filtered = records.filter((record) => config.filters.every((rule) => {
    const actual = getViewFieldValue(record, rule.fieldId, formName, submitterOrganizations).toLowerCase();
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
      const comparison = getViewFieldValue(left, rule.fieldId, formName, submitterOrganizations).localeCompare(getViewFieldValue(right, rule.fieldId, formName, submitterOrganizations), undefined, { numeric: true, sensitivity: "base" });
      if (comparison !== 0) return rule.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

function getBuiltinRecordValues(
  record: FormRecord,
  formName: string,
  submitterOrganizations: Record<string, string>,
): Record<string, string> {
  return {
    instanceId: record.id,
    instanceTitle: `${record.createdBy}发起的${formName}`,
    submitter: record.createdBy,
    submitterOrganization: submitterOrganizations[record.createdBy] ?? "-",
    createdAt: formatDateTime(record.createdAt),
    updatedAt: formatDateTime(record.updatedAt),
  };
}

function formatDateTime(value: string) {
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

function estimateTableColumnWidth(
  values: string[],
  minWidth = 0,
  maxWidth = 320,
) {
  const widestUnits = values.reduce((widest, value) => {
    const units = Array.from(value).reduce(
      (total, character) => total + (/^[\u0000-\u00ff]$/.test(character) ? 0.62 : 1),
      0,
    );
    return Math.max(widest, units);
  }, 0);

  return Math.min(maxWidth, Math.max(minWidth, Math.ceil(widestUnits * 12 + 24)));
}
