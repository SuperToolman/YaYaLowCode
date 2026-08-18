"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRotateRight, Eye, TrashBin } from "@gravity-ui/icons";
import { Alert, Button, Chip, EmptyState, Modal, Table, Tooltip } from "@heroui/react";
import { SettingsContentCard } from "../_components/settings-content-card";

type LogLevel = "all" | "debug" | "info" | "warn" | "error";
type PlatformLog = {
  id: string;
  occurredAt: string;
  level: Exclude<LogLevel, "all">;
  target: string;
  message: string;
  fields: Record<string, unknown>;
};
type Envelope<T> = { code: number; data: T | null; message: string };
type PlatformLogList = { records: PlatformLog[]; totalCount: number; totalSizeBytes: number };

const levelLabels: Record<Exclude<LogLevel, "all">, string> = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

const levelColors: Record<Exclude<LogLevel, "all">, "default" | "accent" | "warning" | "danger"> = {
  debug: "default",
  info: "accent",
  warn: "warning",
  error: "danger",
};

const PAGE_SIZE = 200;

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function uniqueLogs(records: PlatformLog[]) {
  const seen = new Set<string>();
  return records.filter((record) => !seen.has(record.id) && Boolean(seen.add(record.id)));
}

export default function PlatformLogsPage() {
  const [level, setLevel] = useState<LogLevel>("all");
  const [logs, setLogs] = useState<PlatformLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [viewing, setViewing] = useState<PlatformLog | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  const loadLogs = useCallback(async (nextLevel: LogLevel, offset = 0) => {
    const append = offset > 0;
    if (append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (nextLevel !== "all") params.set("level", nextLevel);
      const response = await fetch(`/api/settings/logs?${params}`, { cache: "no-store" });
      const payload = await response.json() as Envelope<PlatformLogList>;
      const data = payload.data;
      if (!response.ok || payload.code !== 0 || !data) throw new Error(payload.message || "无法加载平台日志");
      const records = uniqueLogs(data.records);
      setLogs((current) => append ? uniqueLogs([...current, ...records]) : records);
      setHasMore(data.records.length === PAGE_SIZE);
      setTotalCount(data.totalCount);
      setTotalSizeBytes(data.totalSizeBytes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法加载平台日志");
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadLogs("all"); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  function changeLevel(nextLevel: LogLevel) {
    setLevel(nextLevel);
    void loadLogs(nextLevel);
  }

  async function clearLogs() {
    setClearing(true);
    setError("");
    try {
      const response = await fetch("/api/settings/logs", { method: "DELETE" });
      const payload = await response.json() as Envelope<{ clearedSizeBytes: number }>;
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "无法清空平台日志");
      setClearConfirmOpen(false);
      await loadLogs(level);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "无法清空平台日志");
    } finally {
      setClearing(false);
    }
  }

  return <section className="h-full min-h-0">
    <SettingsContentCard
      title="平台日志"
      subtitle="查看保留期内的平台运行事件。日志按时间倒序显示，可继续加载。"
      headerActions={<div className="flex items-center gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly variant="secondary" aria-label="刷新日志" isDisabled={loading || clearing} onPress={() => void loadLogs(level)}><ArrowRotateRight className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>刷新日志</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly variant="ghost" className="text-[var(--color-danger)]" aria-label="清空日志" isDisabled={loading || clearing || totalSizeBytes === 0} onPress={() => setClearConfirmOpen(true)}><TrashBin className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>清空日志</Tooltip.Content></Tooltip></div>}
      bodyClassName="mt-5"
      bodyScrollable={false}
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex shrink-0 flex-wrap items-center gap-2" role="group" aria-label="日志级别筛选">
          {(["all", "debug", "info", "warn", "error"] as const).map((item) => (
            <Button key={item} size="sm" variant={level === item ? "primary" : "secondary"} onPress={() => changeLevel(item)}>
              {item === "all" ? "全部" : levelLabels[item]}
            </Button>
          ))}
          <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{loading ? "正在加载" : `已加载 ${logs.length} / 共 ${totalCount} 条 · 日志文件占用 ${formatFileSize(totalSizeBytes)}`}</span>
        </div>
        {error ? <Alert status="danger" className="shrink-0"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
        <div className="settings-scroll-area min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-border)]">
          <Table className="h-full min-w-[620px]"><Table.ScrollContainer className="h-full overflow-auto"><Table.Content aria-label="平台日志"><Table.Header><Table.Column id="occurred-at" isRowHeader>时间</Table.Column><Table.Column id="level">级别</Table.Column><Table.Column id="target">来源</Table.Column><Table.Column id="actions" className="w-20 text-right">操作</Table.Column></Table.Header><Table.Body renderEmptyState={() => <EmptyState className="min-h-40 py-8 text-sm text-[var(--color-text-secondary)]">{loading ? "正在加载日志…" : "当前筛选条件下没有日志"}</EmptyState>}><Table.Collection items={logs}>{(log) => <Table.Row key={log.id} id={log.id}><Table.Cell><span className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">{new Date(log.occurredAt).toLocaleString("zh-CN", { hour12: false })}</span></Table.Cell><Table.Cell><Chip size="sm" color={levelColors[log.level]} variant="soft">{levelLabels[log.level]}</Chip></Table.Cell><Table.Cell><span className="block max-w-80 truncate font-mono text-xs text-[var(--color-text-secondary)]" title={log.target}>{log.target}</span></Table.Cell><Table.Cell><div className="flex justify-end"><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" variant="ghost" aria-label={`查看 ${log.target} 日志`} onPress={() => setViewing(log)}><Eye className="h-4 w-4" /></Button></Tooltip.Trigger><Tooltip.Content>查看日志</Tooltip.Content></Tooltip></div></Table.Cell></Table.Row>}</Table.Collection></Table.Body></Table.Content></Table.ScrollContainer></Table>
        </div>
        {hasMore ? <div className="flex shrink-0 justify-center"><Button size="sm" variant="secondary" isDisabled={loadingMore} onPress={() => void loadLogs(level, logs.length)}>{loadingMore ? "正在加载…" : "加载更多"}</Button></div> : null}
      </div>
      <Modal isOpen={clearConfirmOpen} onOpenChange={(open) => !clearing && setClearConfirmOpen(open)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!clearing}><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>清空平台日志</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={clearing} /></Modal.Header><Modal.Body><p className="text-sm leading-6 text-[var(--color-text-secondary)]">将删除当前保留期内的全部日志文件，共 {formatFileSize(totalSizeBytes)}。此操作不可恢复。</p></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={clearing} onPress={() => setClearConfirmOpen(false)}>取消</Button><Button className="bg-[var(--color-danger)] text-white" isDisabled={clearing} onPress={() => void clearLogs()}>{clearing ? "清空中…" : "确认清空"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
      <Modal isOpen={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable><Modal.Container placement="center" size="lg"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"><Modal.Header><Modal.Heading>日志详情</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><Modal.Body className="space-y-5"><div className="grid gap-4 sm:grid-cols-3"><LogDetail label="时间">{viewing ? new Date(viewing.occurredAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</LogDetail><LogDetail label="级别">{viewing ? <Chip size="sm" color={levelColors[viewing.level]} variant="soft">{levelLabels[viewing.level]}</Chip> : "-"}</LogDetail><LogDetail label="来源"><span className="break-all font-mono text-xs">{viewing?.target ?? "-"}</span></LogDetail></div><LogDetail label="内容"><p className="whitespace-pre-wrap break-words text-sm leading-6">{viewing?.message || "-"}</p></LogDetail>{viewing && Object.keys(viewing.fields ?? {}).length ? <LogDetail label="附加字段"><pre className="max-h-80 overflow-auto rounded-md bg-[var(--color-bg-subtle)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">{JSON.stringify(viewing.fields, null, 2)}</pre></LogDetail> : null}</Modal.Body><Modal.Footer><Button onPress={() => setViewing(null)}>关闭</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
    </SettingsContentCard>
  </section>;
}

function LogDetail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><p className="text-xs text-[var(--color-text-secondary)]">{label}</p><div className="mt-1.5 text-sm text-[var(--color-text-primary)]">{children}</div></div>;
}
