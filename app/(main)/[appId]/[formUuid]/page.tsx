"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  ListBox,
  ProgressBar,
  SearchField,
  Select,
  TextArea,
  Tooltip,
  toast,
} from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Card } from "@heroui/react/card";
import { Drawer } from "@heroui/react/drawer";
import { Modal } from "@heroui/react/modal";
import {
  ArrowDownToLine,
  ArrowUpArrowDown,
  ArrowUpFromLine,
  Ellipsis,
  Funnel,
  Pencil,
  FaceRobot,
  PaperPlane,
  Plus,
  Sliders,
  TrashBin,
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

type FormRecordList = {
  items: FormRecord[];
  total: number;
};

type FormMetadata = {
  id: string;
  name: string;
};

type ViewKey = "records" | "submit";

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
  const [editingRecord, setEditingRecord] = useState<FormRecord | null>(null);
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

  const activeView: ViewKey = searchParams.get("view") === "submit" ? "submit" : "records";
  const submitButtonText = schema?.pageProps?.submitButtonText?.trim() || "提交";
  const agentConfig = schema?.pageProps?.agent;
  const agentEnabled = Boolean(agentConfig?.enabled);
  const visibleFields = useMemo(
    () => getVisibleDataFields(schema?.fields ?? []),
    [schema?.fields],
  );
  const handleAgentDraftValuesChange = useCallback((values: Record<string, unknown>) => {
    setAgentDraftValues(values);
  }, []);

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
    source: "drawer" | "page",
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
  ) {
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
      setEditingRecord(null);
      toast.success("表单数据已更新", {
        description: `记录 ${recordId} 已保存`,
      });
    } catch {
      toast.danger("更新失败", {
        description: "请确认后端服务正常。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRecord(recordId: string) {
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
    } catch {
      toast.danger("删除记录失败", {
        description: "请确认后端服务正常。",
      });
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

  const filteredRecords = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();

    if (!keyword) {
      return records;
    }

    return records.filter((record) =>
      JSON.stringify(record.data).toLowerCase().includes(keyword),
    );
  }, [records, searchValue]);
  const excelFields = useMemo(
    () => visibleFields.filter((field) => !field.props?.isDisabled && !field.props?.isReadOnly && field.props?.defaultValueType !== "formula"),
    [visibleFields],
  );

  useEffect(() => {
    const availableIds = new Set(records.map((record) => record.id));
    setSelectedRecordIds((current) => {
      const next = new Set([...current].filter((recordId) => availableIds.has(recordId)));
      return next.size === current.size ? current : next;
    });
  }, [records]);

  function toggleRecordSelection(recordId: string, selected: boolean) {
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
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
      <div className="flex h-full min-h-0 items-center justify-center">
        <p className="text-sm text-[var(--color-text-secondary)]">正在加载表单...</p>
      </div>
    );
  }

  function handleViewChange(view: ViewKey) {
    router.replace(`/${appId}/${formUuid}${view === "submit" ? "?view=submit" : ""}`);
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Card className="theme-card-glass mx-auto flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--color-border)] pb-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="mr-1 min-w-0 truncate text-xl font-semibold text-[var(--color-text-primary)]">
              {formMetadataName || schema?.formName || "表单详情"}
            </h1>
            <Tooltip>
              <Button
                isIconOnly
                aria-label="新增"
                className="h-9 w-9 rounded-lg bg-[var(--color-primary)] p-0 text-[var(--color-text-on-primary)]"
                onClick={() => { setAgentDraftValues({}); setAgentValuePatch(undefined); setDrawerOpen(true); }}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Tooltip.Content>新增</Tooltip.Content>
            </Tooltip>
            <Tooltip>
              <Button
                isIconOnly
                aria-label="删除"
                variant="ghost"
                onClick={() => setDeleteOpen(true)}
                className="h-9 w-9 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] p-0 text-[var(--color-danger)]"
              >
                <TrashBin className="h-4 w-4" />
              </Button>
              <Tooltip.Content>删除</Tooltip.Content>
            </Tooltip>
            <Tooltip>
              <Button
                isIconOnly
                aria-label="导入"
                variant="ghost"
                onPress={openImportModal}
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <ArrowUpFromLine className="h-4 w-4" />
              </Button>
              <Tooltip.Content>导入</Tooltip.Content>
            </Tooltip>
            <Tooltip>
              <Button
                isIconOnly
                aria-label="导出"
                variant="ghost"
                onPress={() => void exportSelectedRecords()}
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <ArrowDownToLine className="h-4 w-4" />
              </Button>
              <Tooltip.Content>导出</Tooltip.Content>
            </Tooltip>
            <Tooltip>
              <Button
                isIconOnly
                aria-label="更多"
                variant="ghost"
                className="h-9 w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-0 text-[var(--color-text-primary)]"
              >
                <Ellipsis className="h-4 w-4" />
              </Button>
              <Tooltip.Content>更多</Tooltip.Content>
            </Tooltip>
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
              isActive={activeView === "records"}
              label="全部数据"
              onClick={() => handleViewChange("records")}
            />
            <ViewTab
              isActive={activeView === "submit"}
              label="表单提交"
              onClick={() => handleViewChange("submit")}
            />
            <Button
              variant="ghost"
              className="h-9 rounded-lg border border-dashed border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)]"
            >
              新建视图
            </Button>
            <Button
              variant="ghost"
              className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
            >
              <Funnel className="h-3.5 w-3.5" />
              筛选
            </Button>
            <Button
              variant="ghost"
              className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
            >
              <Sliders className="h-3.5 w-3.5" />
              显示列
            </Button>
            <Button
              variant="ghost"
              className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
            >
              <ArrowUpArrowDown className="h-3.5 w-3.5" />
              排序
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push(`/designer/${formUuid}?appId=${appId}`)}
              className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
            >
              <Pencil className="h-3.5 w-3.5" />
              表单编辑
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {activeView === "records" ? (
            <RecordsTable
              fields={visibleFields}
              formName={formMetadataName || schema.formName || formUuid}
              records={filteredRecords}
              loading={loadingRecords}
              deletingRecordId={deletingRecordId}
              selectedRecordIds={selectedRecordIds}
              submitterOrganizations={submitterOrganizations}
              onDeleteRecord={handleDeleteRecord}
              onEditRecord={setEditingRecord}
              onRecordSelectionChange={toggleRecordSelection}
            />
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
                      schema={schema}
                      initialValues={editingRecord?.data}
                      submitLabel={submitButtonText}
                      submitting={submitting}
                      urlParams={{ appId, formUuid }}
                      onValuesChange={handleAgentDraftValuesChange}
                      valuePatch={agentValuePatch}
                      onSubmit={(values) =>
                        editingRecord
                          ? handleUpdateRecord(editingRecord.id, values)
                          : handleCreateRecord(values, "drawer")
                      }
                    />
                  </div>
                  {agentEnabled && drawerOpen ? (
                    <FormAgentPanel
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

      <Drawer isOpen={editingRecord !== null} onOpenChange={(open) => !open && setEditingRecord(null)}>
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
          <Drawer.Content placement="right" className="!w-[80vw] !max-w-[80vw]">
            <Drawer.Dialog className="theme-menu-surface flex h-full w-full flex-col shadow-[var(--shadow-drawer)]">
              <Drawer.Header className="border-b border-[var(--color-border)] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Drawer.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                      编辑数据
                    </Drawer.Heading>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      修改当前记录后保存，可触发更新自动化。
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    onClick={() => setEditingRecord(null)}
                    className="h-10 w-10 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]"
                  >
                    ×
                  </Button>
                </div>
              </Drawer.Header>
              <Drawer.Body className="flex-1 overflow-y-auto px-6 py-6">
                {editingRecord ? (
                  <RuntimeFormPanel
                    schema={schema}
                    initialValues={editingRecord.data}
                    submitLabel="保存修改"
                    submitting={submitting}
                    urlParams={{ appId, formUuid }}
                    onSubmit={(values) => handleUpdateRecord(editingRecord.id, values)}
                  />
                ) : null}
              </Drawer.Body>
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
        "h-9 rounded-lg px-3 text-xs",
        isActive
          ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
          : "border border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel-soft)]",
      ].join(" ")}
    >
      {label}
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
    setInput("");
    setMessages([]);
    setSessionId(null);
    setError("");
  }, [agentId, formUuid]);

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
  initialValues,
  onValuesChange,
  schema,
  submitLabel,
  submitting,
  urlParams,
  valuePatch,
  onSubmit,
}: {
  initialValues?: Record<string, unknown>;
  onValuesChange?: (values: Record<string, unknown>) => void;
  schema: FormSchema;
  submitLabel: string;
  submitting: boolean;
  urlParams: Record<string, string>;
  valuePatch?: { id: number; values: Record<string, unknown> };
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <RuntimeFormRenderer
      key={JSON.stringify({
        formUuid: schema.formUuid,
        values: initialValues ?? null,
      })}
      initialValues={initialValues}
      onValuesChange={onValuesChange}
      schema={schema}
      submitLabel={submitLabel}
      submitting={submitting}
      urlParams={urlParams}
      valuePatch={valuePatch}
      onSubmit={onSubmit}
    />
  );
}

function RecordsTable({
  deletingRecordId,
  fields,
  formName,
  records,
  selectedRecordIds,
  submitterOrganizations,
  loading,
  onDeleteRecord,
  onEditRecord,
  onRecordSelectionChange,
}: {
  deletingRecordId: string | null;
  fields: SchemaField[];
  formName: string;
  records: FormRecord[];
  selectedRecordIds: Set<string>;
  submitterOrganizations: Record<string, string>;
  loading: boolean;
  onDeleteRecord: (recordId: string) => void;
  onEditRecord: (record: FormRecord) => void;
  onRecordSelectionChange: (recordId: string, selected: boolean) => void;
}) {
  const columns = fields.slice(0, 6);
  const [detailRecord, setDetailRecord] = useState<FormRecord | null>(null);
  const businessColumnWidths = columns.map((field) =>
    estimateTableColumnWidth([
      field.label,
      ...records.map((record) => formatRecordValue(record.data[field.id])),
    ]),
  );
  const builtInColumnWidths = BUILTIN_RECORD_FIELDS.map((field) =>
    estimateTableColumnWidth([
      field.label,
      ...records.map((record) =>
        getBuiltinRecordValues(record, formName, submitterOrganizations)[field.id],
      ),
    ], 0, field.id === "instanceTitle" ? 360 : 260),
  );
  const tableGridTemplate = [
    "64px",
    ...businessColumnWidths.map((width) => `${width}px`),
    ...builtInColumnWidths.map((width) => `${width}px`),
    "minmax(190px, 1fr)",
  ].join(" ");

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
        正在加载数据...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] px-4 py-12 text-center">
        <div className="text-base font-medium text-[var(--color-text-primary)]">暂无数据</div>
        <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
          当前表单还没有提交记录，可以先通过“新增”填写一条数据。
        </div>
      </div>
    );
  }

  const detailBuiltIns = detailRecord
    ? getBuiltinRecordValues(detailRecord, formName, submitterOrganizations)
    : null;

  return (
    <>
    <div className="theme-card-glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
      <div className="data-table-horizontal-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <div
          className="sticky top-0 z-20 grid w-max min-w-full items-center gap-x-2 border-b border-[var(--color-border)] bg-[var(--color-bg-card-glass)] px-3 py-2 text-[12px] font-medium text-[var(--color-text-secondary)] shadow-[0_1px_0_var(--color-border)]"
          style={{
            gridTemplateColumns: tableGridTemplate,
          }}
        >
          <span>序号</span>
          {columns.map((field) => (
            <span key={field.id} className="truncate whitespace-nowrap">{field.label}</span>
          ))}
          {BUILTIN_RECORD_FIELDS.map((field) => (
            <span key={field.id} className="truncate whitespace-nowrap">{field.label}</span>
          ))}
          <span className="sticky right-0 z-30 flex h-full items-center border-l border-[var(--color-border)] bg-[var(--color-bg-card-glass)] pl-3 shadow-[-8px_0_12px_-12px_var(--color-text-secondary)]">
            操作
          </span>
        </div>
        {records.map((record, index) => {
          const builtIns = getBuiltinRecordValues(record, formName, submitterOrganizations);
          return (
          <div
            key={record.id}
            className="group grid w-max min-w-full items-center gap-x-2 border-t border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-panel-soft)]"
            style={{
              gridTemplateColumns: tableGridTemplate,
            }}
          >
            <span className="relative flex min-h-7 items-center text-[var(--color-text-secondary)]">
              <span className={selectedRecordIds.has(record.id) ? "opacity-0" : "transition-opacity group-hover:opacity-0"}>
                {index + 1}
              </span>
              <Checkbox
                aria-label={`选择第 ${index + 1} 行`}
                isSelected={selectedRecordIds.has(record.id)}
                onChange={(selected) => onRecordSelectionChange(record.id, selected)}
                className={[
                  "absolute left-0 transition-opacity",
                  selectedRecordIds.has(record.id)
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                ].join(" ")}
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox>
            </span>
            {columns.map((field) => (
              <span key={field.id} className="truncate">
                {formatRecordValue(record.data[field.id])}
              </span>
            ))}
            {BUILTIN_RECORD_FIELDS.map((field) => (
              <span key={field.id} className="truncate" title={builtIns[field.id]}>
                {builtIns[field.id]}
              </span>
            ))}
            <span className="sticky right-0 z-10 flex h-full items-center gap-1.5 border-l border-[var(--color-border)] bg-[var(--color-bg-card-glass)] pl-3 shadow-[-8px_0_12px_-12px_var(--color-text-secondary)] transition-colors group-hover:bg-[var(--color-bg-panel-soft)]">
              <Button
                variant="ghost"
                className="h-8 gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-text-primary)]"
                onClick={() => onEditRecord(record)}
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
              <Button
                variant="ghost"
                className="h-8 gap-1 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] px-2.5 text-xs text-[var(--color-danger)]"
                isDisabled={deletingRecordId === record.id}
                onClick={() => onDeleteRecord(record.id)}
              >
                <TrashBin className="h-3.5 w-3.5" />
                {deletingRecordId === record.id ? "删除中..." : "删除"}
              </Button>
              <Dropdown>
                <Dropdown.Trigger
                  aria-label={`记录 ${index + 1} 更多操作`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]"
                >
                  <Ellipsis className="h-3.5 w-3.5" />
                </Dropdown.Trigger>
                <Dropdown.Popover>
                  <Dropdown.Menu aria-label={`记录 ${index + 1} 自定义操作`}>
                    <Dropdown.Item id="view" onAction={() => setDetailRecord(record)}>
                      查看详情
                    </Dropdown.Item>
                    <Dropdown.Item id="copy" isDisabled>
                      复制数据（开发中）
                    </Dropdown.Item>
                    <Dropdown.Item id="workflow" isDisabled>
                      发起流程（开发中）
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </span>
          </div>
          );
        })}
      </div>
    </div>
    <Modal
      isOpen={detailRecord !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) setDetailRecord(null);
      }}
    >
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="lg">
          <Modal.Dialog className="flex max-h-[82vh] w-[min(760px,90vw)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--color-border)] px-6 py-4">
              <div className="min-w-0">
                <Modal.Heading className="text-lg font-semibold">查看详情</Modal.Heading>
                <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                  {detailBuiltIns?.instanceTitle ?? formName}
                </p>
              </div>
              <Modal.CloseTrigger aria-label="关闭详情" />
            </Modal.Header>
            <Modal.Body className="overflow-y-auto px-6 py-5">
              <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                {detailRecord && fields.map((field) => (
                  <div key={field.id} className="border-b border-[var(--color-border)] py-3">
                    <dt className="text-xs text-[var(--color-text-secondary)]">{field.label}</dt>
                    <dd className="mt-1 break-words text-sm text-[var(--color-text-primary)]">
                      {formatRecordValue(detailRecord.data[field.id])}
                    </dd>
                  </div>
                ))}
                {detailBuiltIns && BUILTIN_RECORD_FIELDS.map((field) => (
                  <div key={field.id} className="border-b border-[var(--color-border)] py-3">
                    <dt className="text-xs text-[var(--color-text-secondary)]">{field.label}</dt>
                    <dd className="mt-1 break-words text-sm text-[var(--color-text-primary)]">
                      {detailBuiltIns[field.id]}
                    </dd>
                  </div>
                ))}
              </dl>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
    </>
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

function getBuiltinRecordValues(
  record: FormRecord,
  formName: string,
  submitterOrganizations: Record<string, string>,
) {
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
