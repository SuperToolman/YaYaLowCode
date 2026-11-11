"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, ListBox, Select } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import type { ApiAutomationRun } from "../api";
import { logDuration, logTime, nodeKindLabels, orderRunNodes, runStatusLabels, sourceRecordId } from "./model";

type Props = {
  name: string;
  runs: ApiAutomationRun[];
  loading: boolean;
  retryingKey: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onRetryRun: (runId: string) => void;
  onRetryNode: (runId: string, visitId: string) => void;
  onResolve: (runId: string, action: "retry" | "cancel") => void;
};
const pageSize = 10;

export function RunStatus({ status }: { status: string }) {
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs ${status === "failed" ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : status === "success" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{runStatusLabels[status] ?? status}
  </span>;
}

export function AutomationRunLogsModal(props: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [runId, setRunId] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [tab, setTab] = useState("input");
  useEffect(() => {
    // Keep discovering new executions even when the last fetched list is empty or finished.
    const timer = window.setInterval(props.onRefresh, 3000);
    return () => window.clearInterval(timer);
  }, [props.onRefresh]);
  const filtered = useMemo(() => props.runs.filter((run) => {
    const keyword = query.trim().toLowerCase();
    return (status === "all" || run.status === status)
      && (!keyword || `${run.id} ${sourceRecordId(run.triggerSource, run.triggerPayload)}`.toLowerCase().includes(keyword));
  }).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)), [props.runs, query, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const selectedRun = props.runs.find((run) => run.id === runId);
  const visits = selectedRun ? orderRunNodes(selectedRun.nodes) : [];
  const selectedVisit = visits.find((node) => node.id === visitId);
  const output = selectedVisit ? selectedVisit.output : selectedRun?.triggerSource;
  const input = selectedVisit ? selectedVisit.input : selectedRun?.triggerPayload;
  const error = selectedVisit ? selectedVisit.errorMessage : selectedRun?.errorMessage;
  const busy = selectedRun ? props.retryingKey === `run:${selectedRun.id}` || props.retryingKey?.startsWith(`node:${selectedRun.id}:`) : false;

  function openRun(id: string) { setRunId(id); setVisitId(null); setTab("input"); }
  return <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) props.onClose(); }} className="theme-modal-backdrop" isDismissable>
    <Modal.Container placement="center" size="cover">
      <Modal.Dialog className="theme-menu-surface flex h-[92dvh] min-h-0 max-h-[92dvh] w-[96vw] max-w-[1600px] flex-col overflow-hidden rounded-xl shadow-[var(--shadow-dialog)]">
        <Modal.Header className="shrink-0 border-b border-[var(--color-border)]">
          <Modal.Heading>{selectedRun ? "运行日志详情" : "运行日志"}</Modal.Heading>
          <Modal.CloseTrigger aria-label="关闭运行日志" />
        </Modal.Header>
        <Modal.Body className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {selectedRun ? <Button variant="secondary" size="sm" onPress={() => setRunId(null)}>返回实例列表</Button> : null}
              <div><h3 className="font-semibold">{props.name}</h3><p className="text-xs text-[var(--color-text-secondary)]">{selectedRun ? `实例 ${selectedRun.id} · v${selectedRun.flowVersion}` : `共 ${filtered.length} 个执行实例`}</p></div>
            </div>
            <Button size="sm" variant="secondary" isDisabled={props.loading} onPress={props.onRefresh}>{props.loading ? "刷新中…" : "刷新日志"}</Button>
          </div>
          {selectedRun ? <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
                <RunStatus status={selectedRun.status} />
                <span>开始 {logTime(selectedRun.startedAt)}</span><span>完成 {logTime(selectedRun.finishedAt)}</span><span>耗时 {logDuration(selectedRun.durationMs)}</span>
                {selectedRun.retryRunUuid ? <span>来源运行 {selectedRun.retryRunUuid}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedRun.allowedActions.includes("retry") ? <Button size="sm" variant="secondary" isDisabled={Boolean(busy)} onPress={() => props.onRetryRun(selectedRun.id)}>从头重新触发</Button> : null}
                {selectedRun.allowedActions.includes("resolve") ? <>
                  <Button size="sm" isDisabled={Boolean(busy)} onPress={() => props.onResolve(selectedRun.id, "retry")}>核实后重试</Button>
                  <Button size="sm" variant="danger" isDisabled={Boolean(busy)} onPress={() => props.onResolve(selectedRun.id, "cancel")}>取消运行</Button>
                </> : null}
              </div>
            </div>
            {selectedRun.errorMessage ? <p role="alert" className="shrink-0 rounded-md bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">{selectedRun.errorMessage}</p> : null}
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto rounded-lg border border-[var(--color-border)] md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden">
              <nav aria-label="节点流转" className="min-h-0 overflow-y-auto border-b border-[var(--color-border)] p-3 md:border-r md:border-b-0">
                <p className="mb-3 text-xs text-[var(--color-text-secondary)]">按实际开始时间排列 · {visits.length} 次节点执行</p>
                <button type="button" onClick={() => { setVisitId(null); setTab("input"); }} aria-current={!selectedVisit ? "step" : undefined}
                  className={`mb-2 w-full rounded-lg p-3 text-left text-sm ${!selectedVisit ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "hover:bg-[var(--color-bg-subtle)]"}`}>触发信息</button>
                <ol className="space-y-2">{visits.map((node, index) => <li key={node.id}>
                  <button type="button" aria-current={node.id === selectedVisit?.id ? "step" : undefined}
                    onClick={() => { setVisitId(node.id); setTab(node.status === "failed" ? "error" : "input"); }}
                    className={`w-full rounded-lg border p-3 text-left ${node.id === selectedVisit?.id ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-transparent hover:bg-[var(--color-bg-subtle)]"}`}>
                    <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{index + 1}. {node.nodeLabel}</span><RunStatus status={node.status} /></div>
                    <div className="mt-2 text-xs text-[var(--color-text-secondary)]">{logTime(node.startedAt)} · {logDuration(node.durationMs)}</div>
                  </button>
                </li>)}</ol>
                {!visits.length ? <p className="p-3 text-sm text-[var(--color-text-secondary)]">暂无节点执行明细</p> : null}
              </nav>
              <section aria-label="执行详细数据" className="flex min-h-0 min-w-0 flex-col gap-4 p-4">
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                  <div><h4 className="font-semibold">{selectedVisit?.nodeLabel ?? "触发信息"}</h4>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{selectedVisit ? `${nodeKindLabels[selectedVisit.nodeKind] ?? selectedVisit.nodeKind} · 尝试 ${selectedVisit.attempt} · 分支 ${selectedVisit.branchId ?? "历史"}` : `来源记录 ${sourceRecordId(selectedRun.triggerSource, selectedRun.triggerPayload)}`}</p>
                  </div>
                  {selectedVisit?.status === "failed" && selectedRun.allowedActions.includes("retry") ? <Button size="sm" variant="secondary" isDisabled={Boolean(busy)} onPress={() => props.onRetryNode(selectedRun.id, selectedVisit.id)}>从此节点重试</Button> : null}
                </div>
                {selectedVisit ? <div className="grid shrink-0 gap-2 text-xs text-[var(--color-text-secondary)] lg:grid-cols-2">
                  <span>开始时间：{logTime(selectedVisit.startedAt)}</span><span>结束时间：{logTime(selectedVisit.finishedAt)}</span>
                  <span>运行耗时：{logDuration(selectedVisit.durationMs)}</span><span className="break-all">节点 ID：{selectedVisit.nodeKey}</span>
                </div> : <p className="shrink-0 text-xs text-[var(--color-text-secondary)]">触发事件：{selectedRun.triggerEvent} · 执行策略：{selectedRun.executionPolicy === "background" ? "后台执行" : selectedRun.executionPolicy ?? "—"}</p>}
                <div role="group" aria-label="日志数据" className="flex shrink-0 gap-1 border-b border-[var(--color-border)] pb-2">
                  {[["input", selectedVisit ? "输入上下文" : "触发载荷"], ["output", selectedVisit ? "输出" : "触发来源"], ["error", "错误"]].map(([key, label]) => <Button key={key} aria-pressed={tab === key} size="sm" variant={tab === key ? "primary" : "ghost"} onPress={() => setTab(key)}>{label}</Button>)}
                </div>
                <div role="region" aria-label={tab === "error" ? "错误数据" : tab === "output" ? "输出数据" : "输入数据"} className="min-h-[180px] flex-1 overflow-auto rounded-lg bg-[var(--color-bg-subtle)] p-4">
                  <pre className={`text-xs leading-6 ${tab === "error" && error ? "text-[var(--color-danger)]" : "text-[var(--color-text-primary)]"}`}>{tab === "error" ? error || "暂无错误" : JSON.stringify((tab === "input" ? input : output) ?? null, null, 2)}</pre>
                </div>
                <p className="shrink-0 text-xs text-[var(--color-text-secondary)]">重试会执行所选起点及其下游；已成功提交的数据不会自动撤销。</p>
              </section>
            </div>
          </> : <>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Input aria-label="搜索执行实例" placeholder="搜索来源记录 ID / 执行实例 ID" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }} className="w-full sm:max-w-md" />
              <Select aria-label="执行状态" selectedKey={status} onSelectionChange={(key) => { setStatus(String(key ?? "all")); setPage(1); }} className="w-40">
                <Select.Trigger><Select.Value>{status === "all" ? "全部状态" : runStatusLabels[status]}</Select.Value><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{[["all", "全部状态"], ...Object.entries(runStatusLabels)].map(([key, label]) => <ListBox.Item key={key} id={key} textValue={label}>{label}</ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="sticky top-0 bg-[var(--color-bg-subtle)] text-xs text-[var(--color-text-secondary)]"><tr>{["来源记录 ID", "执行实例 ID", "状态", "开始时间", "完成时间", "耗时", "操作"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody>{filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((run) => <tr key={run.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]">
                  <td className="max-w-64 break-all px-4 py-4 text-xs">{sourceRecordId(run.triggerSource, run.triggerPayload)}</td>
                  <td className="max-w-72 break-all px-4 py-4 text-xs">{run.id}<span className="mt-1 block text-[var(--color-text-secondary)]">v{run.flowVersion}{run.retrySource ? " · 重试实例" : ""}</span></td>
                  <td className="px-4 py-4"><RunStatus status={run.status} /></td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs">{logTime(run.startedAt)}</td><td className="whitespace-nowrap px-4 py-4 text-xs">{logTime(run.finishedAt)}</td><td className="whitespace-nowrap px-4 py-4 text-xs">{logDuration(run.durationMs)}</td>
                  <td className="px-4 py-4"><Button size="sm" variant="ghost" aria-label={`查看实例 ${run.id}`} onPress={() => openRun(run.id)}>详情</Button></td>
                </tr>)}</tbody>
              </table>
              {!filtered.length ? <p role="status" className="p-10 text-center text-sm text-[var(--color-text-secondary)]">{props.loading ? "正在加载运行日志…" : props.runs.length ? "没有匹配的执行实例" : "暂无运行日志"}</p> : null}
            </div>
            <div className="flex shrink-0 items-center justify-between text-xs text-[var(--color-text-secondary)]"><span>每页 {pageSize} 条 · 共 {filtered.length} 条</span><div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" isDisabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)}>上一页</Button><span>{currentPage} / {totalPages}</span><Button size="sm" variant="secondary" isDisabled={currentPage >= totalPages} onPress={() => setPage(currentPage + 1)}>下一页</Button>
            </div></div>
          </>}
        </Modal.Body>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
