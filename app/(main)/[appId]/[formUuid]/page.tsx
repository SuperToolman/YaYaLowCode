"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, toast } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Card } from "@heroui/react/card";
import { Drawer } from "@heroui/react/drawer";
import {
  RuntimeFormRenderer,
  type RuntimeFormSchema,
  type RuntimeSchemaField,
} from "../../../components/runtime-form-renderer";
import testSchema from "../../../lib/testSchema.json";
import { getSystemPageBySlug, isSystemPageSlug } from "../../../lib/system-pages";

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

type ViewKey = "records" | "submit";

export default function FormHome({
  params,
}: {
  params: Promise<{ appId: string; formUuid: string }>;
}) {
  const { appId, formUuid } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [schema, setSchema] = useState<FormSchema>(testSchema as FormSchema);
  const [systemPageTitle, setSystemPageTitle] = useState<string | null>(
    isSystemPageSlug(formUuid) ? (getSystemPageBySlug(formUuid)?.title ?? null) : null,
  );
  const [records, setRecords] = useState<FormRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FormRecord | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  const activeView: ViewKey = searchParams.get("view") === "submit" ? "submit" : "records";
  const submitButtonText = schema.pageProps?.submitButtonText?.trim() || "提交";
  const visibleFields = useMemo(
    () => getVisibleDataFields(schema.fields),
    [schema.fields],
  );

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
        setRecordsTotal(payload.data.total);
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

        const response = await fetch(`/api/forms/${formUuid}/schema?scope=published`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ApiEnvelope<{
          schema: FormSchema;
        }>;

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

  if (systemPageTitle) {
    return <SystemPageView appId={appId} pageSlug={formUuid} pageTitle={systemPageTitle} />;
  }

  function handleViewChange(view: ViewKey) {
    router.replace(`/${appId}/${formUuid}${view === "submit" ? "?view=submit" : ""}`);
  }

  return (
    <div className="p-3 sm:p-5 lg:p-6">
      <Card className="theme-panel-strong mx-auto max-w-[1280px] p-4 shadow-[0_20px_70px_rgba(31,65,122,0.08)] sm:p-6">
        <div className="flex flex-col gap-4 border-b border-[var(--panel-border)] pb-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                Runtime View
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
                {schema.formName || "表单详情"}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                App：{appId} / Form：{formUuid} / 已保存 {recordsTotal} 条数据
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--accent-strong)]">
                {visibleFields.length} 个字段
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              className="h-10 rounded-lg border border-dashed border-[var(--panel-border)] px-4 text-sm text-[var(--text-secondary)]"
            >
              新建视图
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-background-soft)] p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-10 rounded-lg bg-[var(--accent-strong)] px-4 text-white"
                onClick={() => setDrawerOpen(true)}
              >
                新增
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push(`/designer/${formUuid}?appId=${appId}`)}
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDeleteOpen(true)}
                className="h-10 rounded-lg border border-[var(--danger-strong)]/30 bg-[var(--panel-background)] px-4 text-[var(--danger-strong)]"
              >
                删除
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                导入
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                导出
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                更多
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label="搜索数据"
                className="min-w-[220px] bg-[var(--input-background)]"
                placeholder="搜索数据"
                value={searchValue}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setSearchValue(event.currentTarget.value)
                }
              />
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                筛选
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                显示列
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                排序
              </Button>
            </div>
          </div>

          {activeView === "records" ? (
            <RecordsTable
              fields={visibleFields}
              records={filteredRecords}
              total={recordsTotal}
              loading={loadingRecords}
              deletingRecordId={deletingRecordId}
              onDeleteRecord={handleDeleteRecord}
              onEditRecord={setEditingRecord}
            />
          ) : (
            <RuntimeFormPanel
              schema={schema}
              submitLabel={submitButtonText}
              submitting={submitting}
              urlParams={{ appId, formUuid }}
              onSubmit={(values) => handleCreateRecord(values, "page")}
            />
          )}
        </div>
      </Card>

      <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Backdrop className="bg-black/30" isDismissable>
          <Drawer.Content placement="right" className="w-full max-w-[880px]">
            <Drawer.Dialog className="theme-menu-surface flex h-full w-full flex-col shadow-[0_30px_80px_rgba(20,33,61,0.18)]">
              <Drawer.Header className="border-b border-[var(--panel-border)] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Drawer.Heading className="text-lg font-semibold text-[var(--text-primary)]">
                      新增数据
                    </Drawer.Heading>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      使用已发布的表单设计填写并提交数据。
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    onClick={() => setDrawerOpen(false)}
                    className="h-10 w-10 rounded-full border border-[var(--panel-border)] bg-[var(--panel-background)] text-[var(--text-secondary)]"
                  >
                    ×
                  </Button>
                </div>
              </Drawer.Header>
              <Drawer.Body className="flex-1 overflow-y-auto px-6 py-6">
                <RuntimeFormPanel
                  schema={schema}
                  initialValues={editingRecord?.data}
                  submitLabel={submitButtonText}
                  submitting={submitting}
                  urlParams={{ appId, formUuid }}
                  onSubmit={(values) =>
                    editingRecord
                      ? handleUpdateRecord(editingRecord.id, values)
                      : handleCreateRecord(values, "drawer")
                  }
                />
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Drawer isOpen={editingRecord !== null} onOpenChange={(open) => !open && setEditingRecord(null)}>
        <Drawer.Backdrop className="bg-black/30" isDismissable>
          <Drawer.Content placement="right" className="w-full max-w-[880px]">
            <Drawer.Dialog className="theme-menu-surface flex h-full w-full flex-col shadow-[0_30px_80px_rgba(20,33,61,0.18)]">
              <Drawer.Header className="border-b border-[var(--panel-border)] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Drawer.Heading className="text-lg font-semibold text-[var(--text-primary)]">
                      编辑数据
                    </Drawer.Heading>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      修改当前记录后保存，可触发更新自动化。
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    onClick={() => setEditingRecord(null)}
                    className="h-10 w-10 rounded-full border border-[var(--panel-border)] bg-[var(--panel-background)] text-[var(--text-secondary)]"
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
        <AlertDialog.Backdrop className="bg-black/40" />
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog className="theme-menu-surface rounded-2xl shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <AlertDialog.Header className="border-b border-[var(--panel-border)] px-5 py-4">
              <AlertDialog.Heading className="text-lg font-semibold text-[var(--text-primary)]">
                删除表单
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[var(--text-secondary)]">
              删除后，表单设计、提交记录和导航项都会被移除。
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[var(--panel-border)] px-5 py-3">
              <Button
                variant="ghost"
                onClick={() => setDeleteOpen(false)}
                className="h-10 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-background)] px-4 text-[var(--text-primary)]"
              >
                取消
              </Button>
              <Button
                onClick={handleDeleteForm}
                isDisabled={deleting}
                className="h-10 rounded-lg bg-[var(--danger-strong)] px-4 text-white"
              >
                {deleting ? "删除中..." : "确认删除"}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
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
        "h-10 rounded-lg px-4 text-sm",
        isActive
          ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-strong)]"
          : "border border-transparent text-[var(--text-secondary)] hover:bg-[var(--panel-background-soft)]",
      ].join(" ")}
    >
      {label}
    </Button>
  );
}

function RuntimeFormPanel({
  initialValues,
  schema,
  submitLabel,
  submitting,
  urlParams,
  onSubmit,
}: {
  initialValues?: Record<string, unknown>;
  schema: FormSchema;
  submitLabel: string;
  submitting: boolean;
  urlParams: Record<string, string>;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <RuntimeFormRenderer
      key={JSON.stringify({
        formUuid: schema.formUuid,
        values: initialValues ?? null,
      })}
      initialValues={initialValues}
      schema={schema}
      submitLabel={submitLabel}
      submitting={submitting}
      urlParams={urlParams}
      onSubmit={onSubmit}
    />
  );
}

function RecordsTable({
  deletingRecordId,
  fields,
  records,
  total,
  loading,
  onDeleteRecord,
  onEditRecord,
}: {
  deletingRecordId: string | null;
  fields: SchemaField[];
  records: FormRecord[];
  total: number;
  loading: boolean;
  onDeleteRecord: (recordId: string) => void;
  onEditRecord: (record: FormRecord) => void;
}) {
  const columns = fields.slice(0, 6);

  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--panel-border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
        正在加载数据...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--panel-border)] px-4 py-12 text-center">
        <div className="text-base font-medium text-[var(--text-primary)]">暂无数据</div>
        <div className="mt-2 text-sm text-[var(--text-muted)]">
          当前表单还没有提交记录，可以先通过“新增”填写一条数据。
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--panel-border)]">
      <div className="flex items-center justify-between bg-[var(--panel-background-soft)] px-4 py-3 text-sm text-[var(--text-secondary)]">
        <span>共 {total} 条数据</span>
        <span>当前展示 {records.length} 条</span>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[1080px] border-t border-[var(--panel-border)] bg-[var(--panel-background-soft)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr)) 120px 180px 160px`,
          }}
        >
          {columns.map((field) => (
            <span key={field.id}>{field.label}</span>
          ))}
          <span>提交人</span>
          <span>提交时间</span>
          <span>操作</span>
        </div>
        {records.map((record) => (
          <div
            key={record.id}
            className="grid min-w-[1080px] border-t border-[var(--panel-border)] px-4 py-4 text-sm text-[var(--text-primary)]"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr)) 120px 180px 160px`,
            }}
          >
            {columns.map((field) => (
              <span key={field.id} className="truncate">
                {formatRecordValue(record.data[field.id])}
              </span>
            ))}
            <span>{record.createdBy}</span>
            <span>{formatDateTime(record.createdAt)}</span>
            <span className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="h-8 rounded-md border border-[var(--panel-border)] bg-[var(--panel-background)] px-3 text-[var(--text-primary)]"
                onClick={() => onEditRecord(record)}
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                className="h-8 rounded-md border border-[var(--danger-strong)]/30 bg-[var(--panel-background)] px-3 text-[var(--danger-strong)]"
                isDisabled={deletingRecordId === record.id}
                onClick={() => onDeleteRecord(record.id)}
              >
                {deletingRecordId === record.id ? "删除中..." : "删除"}
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
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
    <div className="">
      <div className=" shadow-[0_20px_70px_rgba(31,65,122,0.08)]">
        <Card className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
              System Page
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{pageTitle}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              应用 {appId} 的内置工作台页面，当前路由为 {pageSlug}。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              aria-label={`${pageTitle}搜索`}
              className="w-full min-w-[220px] md:w-[280px]"
              placeholder="搜索标题、流程或发起人"
            />
            <Button className="bg-[var(--accent-strong)] text-white">筛选</Button>
          </div>
        </Card>

        <div className="overflow-hidden rounded-xl border border-[var(--panel-border)]">
          <div className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px] gap-4 bg-[var(--panel-background-soft)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">
            <span>标题</span>
            <span>状态</span>
            <span>发起人</span>
            <span>更新时间</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px] gap-4 border-t border-[var(--panel-border)] px-4 py-4 text-sm text-[var(--text-primary)]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text-primary)]">{row.title}</div>
                <div className="mt-1 truncate text-xs text-[var(--text-muted)]">{row.description}</div>
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
      field.type !== "button" &&
      field.type !== "link",
  );
}

function formatRecordValue(value: unknown) {
  if (Array.isArray(value)) {
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
  });
}
