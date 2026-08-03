"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRotateRight, TrashBin } from "@gravity-ui/icons";
import { Button, Modal, Tooltip } from "@heroui/react";
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
type PlatformLogList = { records: PlatformLog[]; totalSizeBytes: number };

const levelLabels: Record<Exclude<LogLevel, "all">, string> = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

const levelClasses: Record<Exclude<LogLevel, "all">, string> = {
  debug: "bg-[var(--color-control-soft)] text-[var(--color-text-secondary)]",
  info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
  warn: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  error: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
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
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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
          <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{loading ? "正在加载" : `已加载 ${logs.length} 条 · 日志文件占用 ${formatFileSize(totalSizeBytes)}`}</span>
        </div>
        {error ? <div className="shrink-0 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div> : null}
        <div className="settings-scroll-area min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-border)]">
          {logs.length ? <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--color-control-soft)] text-xs text-[var(--color-text-secondary)]"><tr><th className="px-3 py-2 font-medium">时间</th><th className="px-3 py-2 font-medium">级别</th><th className="px-3 py-2 font-medium">来源</th><th className="px-3 py-2 font-medium">内容</th></tr></thead>
            <tbody>{logs.map((log) => <tr key={log.id} className="border-t border-[var(--color-border)] align-top hover:bg-[var(--color-bg-hover)]"><td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--color-text-secondary)]">{new Date(log.occurredAt).toLocaleString("zh-CN", { hour12: false })}</td><td className="px-3 py-2"><span className={`inline-flex min-w-10 justify-center rounded px-2 py-0.5 text-xs font-medium ${levelClasses[log.level]}`}>{levelLabels[log.level]}</span></td><td className="max-w-48 truncate px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]" title={log.target}>{log.target}</td><td className="px-3 py-2"><p className="break-words text-[var(--color-text-primary)]">{log.message}</p>{Object.keys(log.fields ?? {}).length ? <pre className="mt-1 max-w-[680px] overflow-x-auto whitespace-pre-wrap break-words text-xs text-[var(--color-text-secondary)]">{JSON.stringify(log.fields, null, 2)}</pre> : null}</td></tr>)}</tbody>
          </table> : <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-[var(--color-text-secondary)]">{loading ? "正在加载日志…" : "当前筛选条件下没有日志"}</div>}
        </div>
        {hasMore ? <div className="flex shrink-0 justify-center"><Button size="sm" variant="secondary" isDisabled={loadingMore} onPress={() => void loadLogs(level, logs.length)}>{loadingMore ? "正在加载…" : "加载更多"}</Button></div> : null}
      </div>
      <Modal isOpen={clearConfirmOpen} onOpenChange={(open) => !clearing && setClearConfirmOpen(open)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!clearing}><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>清空平台日志</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={clearing} /></Modal.Header><Modal.Body><p className="text-sm leading-6 text-[var(--color-text-secondary)]">将删除当前保留期内的全部日志文件，共 {formatFileSize(totalSizeBytes)}。此操作不可恢复。</p></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={clearing} onPress={() => setClearConfirmOpen(false)}>取消</Button><Button className="bg-[var(--color-danger)] text-white" isDisabled={clearing} onPress={() => void clearLogs()}>{clearing ? "清空中…" : "确认清空"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
    </SettingsContentCard>
  </section>;
}
