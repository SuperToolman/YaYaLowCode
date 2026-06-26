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
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    <div className="p-6">
      <Card className="mx-auto max-w-[1280px] border border-[#dce7f5] bg-white/95 p-6 shadow-[0_20px_70px_rgba(31,65,122,0.08)]">
        <div className="flex flex-col gap-4 border-b border-[#e9eff8] pb-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7c8ca6]">
                Runtime View
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-[#14213d]">
                {schema.formName || "表单详情"}
              </h1>
              <p className="mt-1 text-sm text-[#65748f]">
                App：{appId} / Form：{formUuid} / 已保存 {recordsTotal} 条数据
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#edf4ff] px-3 py-1 text-sm font-medium text-[#2f6bff]">
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
              className="h-10 rounded-lg border border-dashed border-[#ccd8ea] px-4 text-sm text-[#6a7d99]"
            >
              新建视图
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-3 rounded-xl border border-[#e5edf8] bg-[#f9fbff] p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-10 rounded-lg bg-[#2f6bff] px-4 text-white"
                onClick={() => setDrawerOpen(true)}
              >
                新增
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push(`/designer/${formUuid}?appId=${appId}`)}
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                编辑
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDeleteOpen(true)}
                className="h-10 rounded-lg border border-[#f2d4d7] bg-white px-4 text-[#c24152]"
              >
                删除
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                导入
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                导出
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                更多
              </Button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label="搜索数据"
                className="min-w-[220px] bg-white"
                placeholder="搜索数据"
                value={searchValue}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setSearchValue(event.currentTarget.value)
                }
              />
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                筛选
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                显示列
              </Button>
              <Button
                variant="ghost"
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
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
        <Drawer.Backdrop className="bg-[#14213d]/10" isDismissable>
          <Drawer.Content placement="right" className="w-full max-w-[880px]">
            <Drawer.Dialog className="flex h-full w-full flex-col bg-white text-[#202f45] shadow-[0_30px_80px_rgba(20,33,61,0.18)]">
              <Drawer.Header className="border-b border-[#eef2f7] px-6 py-4">
                <div className="flex w-full items-center justify-between gap-4">
                  <div>
                    <Drawer.Heading className="text-lg font-semibold text-[#14213d]">
                      新增数据
                    </Drawer.Heading>
                    <p className="mt-1 text-sm text-[#6a7d99]">
                      使用已发布的表单设计填写并提交数据。
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    onClick={() => setDrawerOpen(false)}
                    className="h-10 w-10 rounded-full border border-[#d7e2f1] bg-white text-[#60738f]"
                  >
                    ×
                  </Button>
                </div>
              </Drawer.Header>
              <Drawer.Body className="flex-1 overflow-y-auto px-6 py-6">
                <RuntimeFormPanel
                  schema={schema}
                  submitLabel={submitButtonText}
                  submitting={submitting}
                  urlParams={{ appId, formUuid }}
                  onSubmit={(values) => handleCreateRecord(values, "drawer")}
                />
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <AlertDialog isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Backdrop className="bg-[#14213d]/20" />
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog className="rounded-2xl bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <AlertDialog.Header className="border-b border-[#eef2f7] px-5 py-4">
              <AlertDialog.Heading className="text-lg font-semibold text-[#14213d]">
                删除表单
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[#5f718e]">
              删除后，表单设计、提交记录和导航项都会被移除。
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[#eef2f7] px-5 py-3">
              <Button
                variant="ghost"
                onClick={() => setDeleteOpen(false)}
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                取消
              </Button>
              <Button
                onClick={handleDeleteForm}
                isDisabled={deleting}
                className="h-10 rounded-lg bg-[#c24152] px-4 text-white"
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
          ? "bg-[#edf4ff] font-medium text-[#2f6bff]"
          : "border border-transparent text-[#5f718e] hover:bg-[#f4f8ff]",
      ].join(" ")}
    >
      {label}
    </Button>
  );
}

function RuntimeFormPanel({
  schema,
  submitLabel,
  submitting,
  urlParams,
  onSubmit,
}: {
  schema: FormSchema;
  submitLabel: string;
  submitting: boolean;
  urlParams: Record<string, string>;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <RuntimeFormRenderer
      schema={schema}
      submitLabel={submitLabel}
      submitting={submitting}
      urlParams={urlParams}
      onSubmit={onSubmit}
    />
  );
}

function RecordsTable({
  fields,
  records,
  total,
  loading,
}: {
  fields: SchemaField[];
  records: FormRecord[];
  total: number;
  loading: boolean;
}) {
  const columns = fields.slice(0, 6);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#e1e8f3] px-4 py-10 text-center text-sm text-[#6d7f9a]">
        正在加载数据...
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#d8e3f3] px-4 py-12 text-center">
        <div className="text-base font-medium text-[#14213d]">暂无数据</div>
        <div className="mt-2 text-sm text-[#6d7f9a]">
          当前表单还没有提交记录，可以先通过“新增”填写一条数据。
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#e1e8f3]">
      <div className="flex items-center justify-between bg-[#f7faff] px-4 py-3 text-sm text-[#4b5f7c]">
        <span>共 {total} 条数据</span>
        <span>当前展示 {records.length} 条</span>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[960px] border-t border-[#edf2f8] bg-[#f7faff] px-4 py-3 text-sm font-medium text-[#4b5f7c]"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr)) 120px 180px`,
          }}
        >
          {columns.map((field) => (
            <span key={field.id}>{field.label}</span>
          ))}
          <span>提交人</span>
          <span>提交时间</span>
        </div>
        {records.map((record) => (
          <div
            key={record.id}
            className="grid min-w-[960px] border-t border-[#edf2f8] px-4 py-4 text-sm text-[#263a5c]"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr)) 120px 180px`,
            }}
          >
            {columns.map((field) => (
              <span key={field.id} className="truncate">
                {formatRecordValue(record.data[field.id])}
              </span>
            ))}
            <span>{record.createdBy}</span>
            <span>{formatDateTime(record.createdAt)}</span>
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
    <div className="p-6">
      <Card className="mx-auto max-w-[1180px] border border-[#dce7f5] bg-white/95 p-6 shadow-[0_20px_70px_rgba(31,65,122,0.08)]">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7c8ca6]">
              System Page
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-[#14213d]">{pageTitle}</h1>
            <p className="mt-1 text-sm text-[#65748f]">
              应用 {appId} 的内置工作台页面，当前路由为 {pageSlug}。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              aria-label={`${pageTitle}搜索`}
              className="w-full min-w-[220px] md:w-[280px]"
              placeholder="搜索标题、流程或发起人"
            />
            <Button className="bg-[#2f6bff] text-white">筛选</Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#e1e8f3]">
          <div className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px] gap-4 bg-[#f7faff] px-4 py-3 text-sm font-medium text-[#4b5f7c]">
            <span>标题</span>
            <span>状态</span>
            <span>发起人</span>
            <span>更新时间</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px] gap-4 border-t border-[#edf2f8] px-4 py-4 text-sm text-[#263a5c]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[#14213d]">{row.title}</div>
                <div className="mt-1 truncate text-xs text-[#6d7f9a]">{row.description}</div>
              </div>
              <span>{row.status}</span>
              <span>{row.owner}</span>
              <span>{row.updatedAt}</span>
            </div>
          ))}
        </div>
      </Card>
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
