"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, TextArea, toast } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { approveWorkflowTask, listWorkflowTasks, rejectWorkflowTask } from "../../../lib/api-client";
import { getAppResource } from "../../../lib/app-resources";
import { formatDateTime } from "./form-record-utils";

type ApiEnvelope<T> = { code: number; data: T | null; message: string };
type SystemWorkItem = { id: string; taskType: string; status: string; formUuid: string; formName: string; recordUuid: string; instanceId: string; flowName: string; nodeLabel: string | null; submitter: string; createdAt: string; updatedAt: string; completedAt: string | null };

export function SystemPageView({
  appId,
  pageSlug,
  pageTitle,
}: {
  appId: string;
  pageSlug: string;
  pageTitle: string;
}) {
  const router = useRouter();
  const [appName, setAppName] = useState("");
  const [items, setItems] = useState<SystemWorkItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ item: SystemWorkItem; kind: "approve" | "reject" | "complete" } | null>(null);
  const [actionComment, setActionComment] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getAppResource(appId)
      .then((app) => {
        if (!cancelled) setAppName(app.name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await listWorkflowTasks({ query: { appId, scope: pageSlug }, responseStyle: "fields" });
      const result = data as ApiEnvelope<{ items?: SystemWorkItem[] }> | undefined;
      if (error || result?.code !== 0) throw new Error(result?.message || "加载任务失败");
      setItems(Array.isArray(result.data?.items) ? result.data.items : []);
    } catch (error) {
      setItems([]);
      setLoadError(error instanceof Error ? error.message : "加载任务失败");
    } finally {
      setLoading(false);
    }
  }, [appId, pageSlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadItems();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadItems]);

  const displayAppName = appName || "当前应用";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rows = normalizedQuery ? items.filter((item) => [item.formName, item.flowName, item.nodeLabel, item.submitter, item.instanceId].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedQuery)) : items;

  function openTaskAction(item: SystemWorkItem, kind: "approve" | "reject" | "complete") {
    setActionComment("");
    setPendingAction({ item, kind });
  }

  async function submitTaskAction() {
    if (!pendingAction) return;
    if (pendingAction.kind === "reject" && !actionComment.trim()) {
      toast.danger("请填写拒绝意见");
      return;
    }
    setSubmittingAction(true);
    try {
      const endpoint = pendingAction.kind === "reject" ? "reject" : "approve";
      const request = { path: { taskUuid: pendingAction.item.id }, body: { comment: actionComment.trim() || undefined }, responseStyle: "fields" as const };
      const { data, error } = await (endpoint === "reject" ? rejectWorkflowTask(request) : approveWorkflowTask(request));
      const result = data as ApiEnvelope<unknown> | undefined;
      if (error || result?.code !== 0) throw new Error(result?.message || "任务处理失败");
      toast.success(pendingAction.kind === "reject" ? "已拒绝任务" : pendingAction.kind === "complete" ? "任务已完成" : "已同意任务");
      setPendingAction(null);
      await loadItems();
    } catch (error) {
      toast.danger("任务处理失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setSubmittingAction(false);
    }
  }

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="shadow-[var(--shadow-designer)]">
        <Card className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">{pageTitle}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {displayAppName}中的流程任务与审批记录。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              aria-label={`${pageTitle}搜索`}
              className="w-full min-w-[220px] md:w-[280px]"
              placeholder="搜索标题、流程或发起人"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <Button variant="ghost" onClick={() => void loadItems()}>刷新</Button>
          </div>
        </Card>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
          <div className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px_132px] gap-4 bg-[var(--color-bg-panel-soft)] px-4 py-3 text-sm font-medium text-[var(--color-text-secondary)]">
            <span>标题</span>
            <span>状态</span>
            <span>发起人</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {loading ? <div className="px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">正在加载任务...</div> : null}
          {loadError ? <div className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{loadError}</div> : null}
          {!loading && !loadError && rows.length === 0 ? <div className="px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">暂无相关流程任务</div> : null}
          {!loading && !loadError ? rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,2fr)_120px_160px_180px_132px] items-center gap-4 border-t border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-panel-soft)]"
            >
              <button type="button" className="min-w-0 text-left" onClick={() => router.push(`/${appId}/${row.formUuid}?record=${encodeURIComponent(row.recordUuid)}`)}>
                <div className="truncate font-medium text-[var(--color-text-primary)]">{row.formName}</div>
                <div className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{row.flowName} · {row.nodeLabel || "流程处理中"}</div>
              </button>
              <span>{workflowTaskStatusLabel(row.status)}</span>
              <span>{row.submitter}</span>
              <span>{formatDateTime(row.completedAt || row.updatedAt || row.createdAt)}</span>
              <div className="flex items-center gap-1">
                {pageSlug === "todo" && row.status === "pending" && row.taskType === "approval" ? <><Button size="sm" onPress={() => openTaskAction(row, "approve")}>同意</Button><Button size="sm" variant="ghost" className="text-[var(--color-danger)]" onPress={() => openTaskAction(row, "reject")}>拒绝</Button></> : null}
                {pageSlug === "todo" && row.status === "pending" && row.taskType === "execution" ? <Button size="sm" onPress={() => openTaskAction(row, "complete")}>完成</Button> : null}
                {pageSlug !== "todo" || row.status !== "pending" ? <span className="text-xs text-[var(--color-text-secondary)]">已处理</span> : null}
              </div>
            </div>
          )) : null}
        </div>
      </div>
      <Modal isOpen={pendingAction !== null} onOpenChange={(open) => { if (!open && !submittingAction) setPendingAction(null); }}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable={!submittingAction}>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="theme-menu-surface rounded-2xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">{pendingAction?.kind === "reject" ? "拒绝任务" : pendingAction?.kind === "complete" ? "完成任务" : "同意任务"}</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body className="space-y-3 px-5 py-4">
                <div className="text-sm text-[var(--color-text-secondary)]">{pendingAction?.item.formName} · {pendingAction?.item.nodeLabel}</div>
                <TextArea aria-label="审批意见" placeholder={pendingAction?.kind === "reject" ? "请填写拒绝原因" : "可填写审批意见"} value={actionComment} onChange={(event) => setActionComment(event.currentTarget.value)} disabled={submittingAction} />
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
                <Button variant="ghost" isDisabled={submittingAction} onPress={() => setPendingAction(null)}>取消</Button>
                <Button isDisabled={submittingAction || (pendingAction?.kind === "reject" && !actionComment.trim())} onPress={() => void submitTaskAction()} className={pendingAction?.kind === "reject" ? "bg-[var(--color-danger)] text-white" : undefined}>{submittingAction ? "处理中..." : pendingAction?.kind === "reject" ? "确认拒绝" : pendingAction?.kind === "complete" ? "确认完成" : "确认同意"}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function workflowTaskStatusLabel(status: string) {
  return ({ pending: "待处理", approved: "已同意", rejected: "已拒绝", completed: "已完成", running: "进行中", failed: "失败" } as Record<string, string>)[status] ?? status;
}
