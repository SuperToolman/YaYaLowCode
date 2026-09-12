"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRotateRight, Eye, TrashBin } from "@gravity-ui/icons";
import { Alert, Button, Chip, EmptyState, Modal, Table, Tabs, Tooltip } from "@heroui/react";
import { SettingsContentCard } from "../components/SettingsContentCard";
import styles from "./logs.module.css";

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

  return <section className={styles.page}>
    <SettingsContentCard
      title="平台日志"
      subtitle="查看保留期内的平台运行事件。日志按时间倒序显示，可继续加载。"
      headerActions={<div className={styles.headerActions}><Tooltip><Tooltip.Trigger><Button isIconOnly aria-label="刷新日志" isDisabled={loading || clearing} onPress={() => void loadLogs(level)}><ArrowRotateRight /></Button></Tooltip.Trigger><Tooltip.Content>刷新日志</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly variant="danger" aria-label="清空日志" isDisabled={loading || clearing || totalSizeBytes === 0} onPress={() => setClearConfirmOpen(true)}><TrashBin /></Button></Tooltip.Trigger><Tooltip.Content>清空日志</Tooltip.Content></Tooltip></div>}
      bodyClassName={styles.body}
      bodyScrollable={false}
    >
      <div className={styles.content}>
        <div className={styles.toolbar}>
          <Tabs selectedKey={level} onSelectionChange={(key) => changeLevel(String(key) as LogLevel)} aria-label="日志级别筛选">
            <Tabs.List>
              {(["all", "debug", "info", "warn", "error"] as const).map((item) => (
                <Tabs.Tab key={item} id={item}>
                  {item === "all" ? "全部" : levelLabels[item]}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
          <span className={styles.summary}>{loading ? "正在加载" : `已加载 ${logs.length} / 共 ${totalCount} 条 · 日志文件占用 ${formatFileSize(totalSizeBytes)}`}</span>
        </div>
        {error ? <Alert status="danger" className={styles.alert}><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
        <Table className={styles.table}><Table.ScrollContainer className={styles.scrollContainer}><Table.Content aria-label="平台日志"><Table.Header><Table.Column id="occurred-at" isRowHeader>时间</Table.Column><Table.Column id="level">级别</Table.Column><Table.Column id="target">来源</Table.Column><Table.Column id="actions" className={styles.actionsColumn}>操作</Table.Column></Table.Header><Table.Body renderEmptyState={() => <EmptyState className={styles.empty}>{loading ? "正在加载日志…" : "当前筛选条件下没有日志"}</EmptyState>}><Table.Collection items={logs}>{(log) => <Table.Row key={log.id} id={log.id}><Table.Cell><span className={styles.time}>{new Date(log.occurredAt).toLocaleString("zh-CN", { hour12: false })}</span></Table.Cell><Table.Cell><Chip size="sm" color={levelColors[log.level]}>{levelLabels[log.level]}</Chip></Table.Cell><Table.Cell><span className={styles.target} title={log.target}>{log.target}</span></Table.Cell><Table.Cell><div className={styles.actions}><Tooltip><Tooltip.Trigger><Button isIconOnly size="sm" aria-label={`查看 ${log.target} 日志`} onPress={() => setViewing(log)}><Eye /></Button></Tooltip.Trigger><Tooltip.Content>查看日志</Tooltip.Content></Tooltip></div></Table.Cell></Table.Row>}</Table.Collection></Table.Body></Table.Content></Table.ScrollContainer></Table>
        {hasMore ? <div className={styles.loadMore}><Button size="sm" isDisabled={loadingMore} onPress={() => void loadLogs(level, logs.length)}>{loadingMore ? "正在加载…" : "加载更多"}</Button></div> : null}
      </div>
      <Modal isOpen={clearConfirmOpen} onOpenChange={(open) => !clearing && setClearConfirmOpen(open)}><Modal.Backdrop isDismissable={!clearing}><Modal.Container placement="center" size="sm"><Modal.Dialog><Modal.Header><Modal.Heading>清空平台日志</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={clearing} /></Modal.Header><Modal.Body><p className={styles.modalText}>将删除当前保留期内的全部日志文件，共 {formatFileSize(totalSizeBytes)}。此操作不可恢复。</p></Modal.Body><Modal.Footer><Button isDisabled={clearing} onPress={() => setClearConfirmOpen(false)}>取消</Button><Button className={styles.dangerButton} isDisabled={clearing} onPress={() => void clearLogs()}>{clearing ? "清空中…" : "确认清空"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
      <Modal isOpen={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}><Modal.Backdrop isDismissable><Modal.Container placement="center" size="lg"><Modal.Dialog><Modal.Header><Modal.Heading>日志详情</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header><Modal.Body className={styles.detailBody}><div className={styles.detailGrid}><LogDetail label="时间">{viewing ? new Date(viewing.occurredAt).toLocaleString("zh-CN", { hour12: false }) : "-"}</LogDetail><LogDetail label="级别">{viewing ? <Chip size="sm" color={levelColors[viewing.level]}>{levelLabels[viewing.level]}</Chip> : "-"}</LogDetail><LogDetail label="来源"><span className={styles.detailMono}>{viewing?.target ?? "-"}</span></LogDetail></div><LogDetail label="内容"><p className={styles.message}>{viewing?.message || "-"}</p></LogDetail>{viewing && Object.keys(viewing.fields ?? {}).length ? <LogDetail label="附加字段"><pre className={styles.pre}>{JSON.stringify(viewing.fields, null, 2)}</pre></LogDetail> : null}</Modal.Body><Modal.Footer><Button onPress={() => setViewing(null)}>关闭</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
    </SettingsContentCard>
  </section>;
}

function LogDetail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={styles.detail}><p className={styles.detailLabel}>{label}</p><div className={styles.detailValue}>{children}</div></div>;
}

