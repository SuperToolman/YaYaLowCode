"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Checkbox, Drawer, EmptyState, Modal, Table, toast, type Selection } from "@heroui/react";
import { ArrowRotateLeft, Eye, TrashBin } from "@gravity-ui/icons";
import { RuntimeFormRenderer, type RuntimeFormSchema } from "../../components/runtime-form-renderer";
import { getFormSchema } from "@/features/form-runtime/api";

type Entry = { id: string; formUuid: string; recordUuid: string; sourceAppName: string | null; sourceFormName: string; formType: string; deletedAt: string; expiresAt: string; recordData: Record<string, unknown> };
type Envelope<T> = { code: number; message: string; data: T | null };
type DeleteConfirmation = { kind: "entries"; entries: Entry[] } | { kind: "all" } | null;

const typeLabel: Record<string, string> = { normal: "普通表单", workflow: "流程表单", detail: "明细表" };
const destructiveButtonClass = "bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]";

export default function RecycleBinPage() {
  return <Suspense fallback={<main className="theme-page-shell h-full min-h-[480px]" />}><RecycleBinContent /></Suspense>;
}

function RecycleBinContent() {
  const searchParams = useSearchParams();
  const formUuidFilter = searchParams.get("formUuid")?.trim() ?? "";
  const [items, setItems] = useState<Entry[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation>(null);
  const [preview, setPreview] = useState<Entry | null>(null);
  const [previewSchema, setPreviewSchema] = useState<RuntimeFormSchema | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const query = formUuidFilter ? `?formUuid=${encodeURIComponent(formUuidFilter)}` : "";
      const response = await fetch(`/api/recycle-bin${query}`, { cache: "no-store" });
      const body = await response.json() as Envelope<Entry[]>;
      if (!response.ok || body.code !== 0) throw new Error(body.message);
      setItems(body.data ?? []);
      setSelectedKeys(new Set());
    } catch (error) {
      toast.danger("无法加载回收站", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setLoading(false);
    }
  };

  // The timer postpones the initial request until after hydration and is rerun when the URL filter changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [formUuidFilter]);

  const restoreEntries = async (entries: Entry[], successMessage: string) => {
    if (!entries.length) return;
    setBusy("restore");
    try {
      for (const item of entries) {
        const response = await fetch(`/api/recycle-bin/${item.id}/restore`, { method: "POST" });
        const body = await response.json() as Envelope<unknown>;
        if (!response.ok || body.code !== 0) throw new Error(body.message);
      }
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.danger("恢复失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setBusy(null);
    }
  };

  const permanentlyDeleteEntries = async (entries: Entry[]) => {
    if (!entries.length) return;
    setBusy("delete");
    try {
      for (const item of entries) {
        const response = await fetch(`/api/recycle-bin/${item.id}`, { method: "DELETE" });
        const body = await response.json() as Envelope<unknown>;
        if (!response.ok || body.code !== 0) throw new Error(body.message);
      }
      toast.success(entries.length === 1 ? "数据已永久删除" : `已永久删除 ${entries.length} 条数据`);
      setDeleteConfirmation(null);
      await load();
    } catch (error) {
      toast.danger("永久删除失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setBusy(null);
    }
  };

  const emptyRecycleBin = async () => {
    setBusy("all");
    try {
      const response = await fetch("/api/recycle-bin", { method: "DELETE" });
      const body = await response.json() as Envelope<unknown>;
      if (!response.ok || body.code !== 0) throw new Error(body.message);
      toast.success("回收站已清空");
      setDeleteConfirmation(null);
      await load();
    } catch (error) {
      toast.danger("清空失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setBusy(null);
    }
  };

  const view = async (item: Entry) => {
    setPreview(item); setPreviewSchema(null); setPreviewError(null); setPreviewLoading(true);
    try {
      const result = await getFormSchema({ path: { formUuid: item.formUuid }, query: { scope: "published" }, responseStyle: "fields" });
      const schema = result.data?.code === 0 ? result.data.data?.schema : null;
      if (result.error || !schema) throw new Error(result.data?.message ?? "原表单已删除或其 Schema 不可用");
      setPreviewSchema(schema as RuntimeFormSchema);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "无法加载表单定义");
    } finally {
      setPreviewLoading(false);
    }
  };

  const selectedItems = selectedKeys === "all" ? items : items.filter((item) => selectedKeys.has(item.id));
  const deletingEntries = deleteConfirmation?.kind === "entries" ? deleteConfirmation.entries : [];
  const deleteTitle = deleteConfirmation?.kind === "all" ? "清空回收站" : deletingEntries.length === 1 ? "永久删除数据" : "永久删除所选";
  const deleteMessage = deleteConfirmation?.kind === "all" ? "回收站中的所有记录将永久删除，且无法恢复。" : deletingEntries.length === 1 ? "该记录将永久删除，且无法恢复。" : `已选中的 ${deletingEntries.length} 条记录将永久删除，且无法恢复。`;

  return <main className="theme-page-shell h-full overflow-auto"><section className="mx-auto w-full py-6"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold text-[var(--color-text-primary)]">回收站</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">已删除的表单数据会在保留期内显示在这里。</p></div><div className="flex flex-wrap items-center justify-end gap-2">{selectedItems.length > 0 ? <><Button variant="secondary" isDisabled={busy !== null} onPress={() => void restoreEntries(selectedItems, `已恢复 ${selectedItems.length} 条数据`)}><ArrowRotateLeft className="h-4 w-4" />恢复所选</Button><Button className={destructiveButtonClass} isDisabled={busy !== null} onPress={() => setDeleteConfirmation({ kind: "entries", entries: selectedItems })}><TrashBin className="h-4 w-4" />清空所选</Button></> : null}<Button variant="secondary" isDisabled={!items.length || busy !== null} onPress={() => void restoreEntries(items, "已恢复全部数据")}><ArrowRotateLeft className="h-4 w-4" />恢复所有</Button><Button className={destructiveButtonClass} isDisabled={!items.length || busy !== null} onPress={() => setDeleteConfirmation({ kind: "all" })}><TrashBin className="h-4 w-4" />清空回收站</Button></div></div><Table><Table.ScrollContainer className="overflow-x-auto"><Table.Content aria-label="回收站数据" selectionMode="multiple" selectedKeys={selectedKeys} onSelectionChange={setSelectedKeys}><Table.Header><Table.Column id="select" className="w-12"><Checkbox slot="selection" aria-label="全选"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Column><Table.Column id="source" isRowHeader>来源（应用 / 表单）</Table.Column><Table.Column id="type">表单类型</Table.Column><Table.Column id="deleted">删除时间</Table.Column><Table.Column id="expires">到期时间</Table.Column><Table.Column id="actions">操作</Table.Column></Table.Header><Table.Body renderEmptyState={() => <EmptyState className="min-h-48 py-10 text-center text-sm text-[var(--color-text-secondary)]">{loading ? "加载中…" : "回收站暂无数据"}</EmptyState>}><Table.Collection items={items}>{(item) => <Table.Row key={item.id} id={item.id}><Table.Cell><Checkbox slot="selection" variant="secondary" aria-label={`选择 ${item.sourceFormName}`} isDisabled={busy !== null}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Cell><Table.Cell><div className="font-medium">{item.sourceAppName ? `${item.sourceAppName} / ${item.sourceFormName}` : item.sourceFormName}</div><div className="text-xs text-[var(--color-text-secondary)]">{item.recordUuid}</div></Table.Cell><Table.Cell>{typeLabel[item.formType] ?? item.formType}</Table.Cell><Table.Cell>{new Date(item.deletedAt).toLocaleString("zh-CN")}</Table.Cell><Table.Cell>{new Date(item.expiresAt).toLocaleString("zh-CN")}</Table.Cell><Table.Cell><div className="flex gap-2"><Button size="sm" variant="secondary" isDisabled={busy !== null} onPress={() => void view(item)}><Eye className="h-4 w-4" />查看</Button><Button size="sm" variant="secondary" isDisabled={busy !== null} onPress={() => void restoreEntries([item], "数据已恢复")}><ArrowRotateLeft className="h-4 w-4" />恢复</Button><Button size="sm" className={destructiveButtonClass} isDisabled={busy !== null} onPress={() => setDeleteConfirmation({ kind: "entries", entries: [item] })}><TrashBin className="h-4 w-4" />永久删除</Button></div></Table.Cell></Table.Row>}</Table.Collection></Table.Body></Table.Content></Table.ScrollContainer></Table></section><Modal isOpen={deleteConfirmation !== null} onOpenChange={(open) => !open && setDeleteConfirmation(null)}><Modal.Backdrop className="theme-modal-backdrop"><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>{deleteTitle}</Modal.Heading></Modal.Header><Modal.Body>{deleteMessage}</Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={busy !== null} onPress={() => setDeleteConfirmation(null)}>取消</Button><Button className={destructiveButtonClass} isDisabled={busy !== null} onPress={() => void (deleteConfirmation?.kind === "all" ? emptyRecycleBin() : permanentlyDeleteEntries(deletingEntries))}><TrashBin className="h-4 w-4" />确认永久删除</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal><Drawer isOpen={preview !== null} onOpenChange={(open) => !open && setPreview(null)}><Drawer.Backdrop className="theme-modal-backdrop"><Drawer.Content placement="right"><Drawer.Dialog className="flex h-[100dvh] w-[min(960px,80vw)] max-w-[96vw] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><Drawer.Header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4"><Drawer.Heading>{preview?.sourceFormName ?? "回收站数据"}</Drawer.Heading><Drawer.CloseTrigger aria-label="关闭" /></Drawer.Header><Drawer.Body className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{previewLoading ? <p className="text-sm text-[var(--color-text-secondary)]">正在加载原始表单…</p> : previewError ? <p className="text-sm text-[var(--color-danger)]">{previewError}</p> : previewSchema && preview ? <RuntimeFormRenderer schema={previewSchema} formId={preview.formUuid} initialValues={preview.recordData} isReadOnly showSubmitButton={false} submitLabel="恢复数据" onSubmit={async () => undefined} /> : null}</Drawer.Body><Drawer.Footer className="shrink-0 justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3"><Button variant="ghost" onPress={() => setPreview(null)}>关闭</Button><Button isDisabled={!preview || previewLoading || previewError !== null || busy !== null} onPress={() => { if (preview) { void restoreEntries([preview], "数据已恢复"); setPreview(null); } }}><ArrowRotateLeft className="h-4 w-4" />恢复数据</Button></Drawer.Footer></Drawer.Dialog></Drawer.Content></Drawer.Backdrop></Drawer></main>;
}
