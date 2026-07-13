"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Dropdown, Input, toast } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Card } from "@heroui/react/card";
import { Drawer } from "@heroui/react/drawer";
import {
  ArrowDownToLine,
  ArrowUpArrowDown,
  ArrowUpFromLine,
  Ellipsis,
  Funnel,
  Pencil,
  Plus,
  Sliders,
  TrashBin,
} from "@gravity-ui/icons";
import {
  RuntimeFormRenderer,
  type RuntimeFormSchema,
  type RuntimeSchemaField,
} from "../../../components/runtime-form-renderer";
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
  const [schema, setSchema] = useState<FormSchema | null>(null);
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
  const submitButtonText = schema?.pageProps?.submitButtonText?.trim() || "提交";
  const visibleFields = useMemo(
    () => getVisibleDataFields(schema?.fields ?? []),
    [schema?.fields],
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
      <Card className="theme-panel-strong mx-auto flex h-full min-h-0 flex-col overflow-hidden shadow-[var(--shadow-designer)]">
        <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--color-border)] pb-4 md:flex-row md:items-center md:justify-between">
          <h1 className="min-w-0 truncate text-xl font-semibold text-[var(--color-text-primary)]">
            {schema?.formName || "表单详情"}
          </h1>
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
              onClick={() => router.push(`/designer/${formUuid}?appId=${appId}`)}
              className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
            >
              <Pencil className="h-3.5 w-3.5" />
              表单编辑
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-9 gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 text-xs text-[var(--color-text-on-primary)]"
                onClick={() => setDrawerOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                新增
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDeleteOpen(true)}
                className="h-9 gap-1.5 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-danger)]"
              >
                <TrashBin className="h-3.5 w-3.5" />
                删除
              </Button>
              <Button
                variant="ghost"
                className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" />
                导入
              </Button>
              <Button
                variant="ghost"
                className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                导出
              </Button>
              <Button
                variant="ghost"
                className="h-9 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-xs text-[var(--color-text-primary)]"
              >
                <Ellipsis className="h-3.5 w-3.5" />
                更多
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label="搜索数据"
                className="min-w-[220px] bg-[var(--color-bg-input)]"
                placeholder="搜索数据"
                value={searchValue}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setSearchValue(event.currentTarget.value)
                }
              />
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

      <Drawer isOpen={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Backdrop className="theme-modal-backdrop" isDismissable>
          <Drawer.Content placement="right" className="!w-[80vw] !max-w-[80vw]">
            <Drawer.Dialog className="theme-menu-surface flex h-full w-full flex-col shadow-[var(--shadow-drawer)]">
              <Drawer.Header className="border-b border-[var(--color-border)] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Drawer.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                      新增数据
                    </Drawer.Heading>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      使用已发布的表单设计填写并提交数据。
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
  const customActions = ["查看详情", "复制数据", "发起流程"];

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)]">
      <div className="flex shrink-0 items-center justify-between bg-[var(--color-bg-panel-soft)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <span>共 {total} 条数据</span>
        <span>当前展示 {records.length} 条</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="sticky top-0 z-10 grid min-w-[1080px] border-t border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)] shadow-[0_1px_0_var(--color-border)]"
          style={{
            gridTemplateColumns: `64px repeat(${columns.length}, minmax(140px, 1fr)) 120px 180px 190px`,
          }}
        >
          <span>序号</span>
          {columns.map((field) => (
            <span key={field.id}>{field.label}</span>
          ))}
          <span>提交人</span>
          <span>提交时间</span>
          <span>操作</span>
        </div>
        {records.map((record, index) => (
          <div
            key={record.id}
            className="grid min-w-[1080px] border-t border-[var(--color-border)] px-4 py-4 text-sm text-[var(--color-text-primary)]"
            style={{
              gridTemplateColumns: `64px repeat(${columns.length}, minmax(140px, 1fr)) 120px 180px 190px`,
            }}
          >
            <span className="text-[var(--color-text-secondary)]">{index + 1}</span>
            {columns.map((field) => (
              <span key={field.id} className="truncate">
                {formatRecordValue(record.data[field.id])}
              </span>
            ))}
            <span>{record.createdBy}</span>
            <span>{formatDateTime(record.createdAt)}</span>
            <span className="flex items-center gap-1.5">
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
                    {customActions.map((action) => (
                      <Dropdown.Item key={action} id={action} isDisabled>
                        {action}（开发中）
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
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
