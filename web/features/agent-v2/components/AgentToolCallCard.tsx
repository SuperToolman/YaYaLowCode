"use client";

import { ArrowChevronDown, Check, Code, Copy } from "@gravity-ui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { KnowledgeSources } from "@/features/knowledge/KnowledgeSources";
import { readExecutionLogs } from "../client";
import type { AgentToolActivity } from "../types";

const json = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "—");

function thrownText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.stderr === "string" && record.stderr.trim()) return record.stderr;
  if (record.result && typeof record.result === "object") return thrownText(record.result);
  return undefined;
}

export function ToolCallCard({
  activity,
  sessionId,
}: {
  activity: AgentToolActivity;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const executionLabels: Record<string, string> = {
    queued: "脚本排队中",
    running: "脚本执行中",
    succeeded: "脚本执行完成",
    failed: "脚本执行失败",
    timed_out: "脚本执行超时",
    cancelled: "脚本已停止",
    outcome_unknown: "执行结果不确定，请勿自动重试",
  };
  const label = activity.executionStatus
    ? (executionLabels[activity.executionStatus] ?? activity.executionStatus)
    : {
        running: "工具执行中",
        completed: "工具已完成",
        waiting_confirmation: "等待确认",
        failed: "工具失败",
        rejected: "已拒绝",
        expired: "已过期",
        cancelled: "已取消",
        conflict: "资源冲突",
      }[activity.status];
  const status = activity.executionStatus ?? activity.status;
  const exception = thrownText(activity.result) ?? (activity.error ? json(activity.error) : undefined);
  const statusColor = ["failed", "timed_out", "conflict"].includes(status)
    ? "bg-danger"
    : ["completed", "succeeded"].includes(status)
      ? "bg-success"
      : ["running", "queued", "waiting_confirmation", "outcome_unknown"].includes(status)
        ? "bg-warning"
        : "bg-muted";

  return (
    <div className="min-w-0 rounded-xl bg-surface text-foreground shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
      >
        <Code className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs" title={`${label} · ${activity.name}`}>
          <span className="text-muted">{label}</span>
          <span className="mx-1.5 text-muted" aria-hidden="true">·</span>
          <span className="font-medium">{activity.name}</span>
        </span>
        <span className={`size-1.5 shrink-0 rounded-full ${statusColor}`} aria-hidden="true" />
        <ArrowChevronDown
          className={`size-3.5 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open}>
        {activity.name.startsWith("knowledge_") && <KnowledgeSources result={activity.result} />}
      {open ? (
          <div className="@container flex min-w-0 flex-col gap-3 px-3 pb-3 pt-1">
            <div className={`grid min-w-0 grid-cols-1 gap-3 ${activity.result !== undefined ? "@min-[36rem]:grid-cols-2" : ""}`}>
              <ToolValue label="参数" value={activity.arguments} />
              {activity.result !== undefined ? (
                <ToolValue label="结果" value={activity.result} />
              ) : null}
            </div>
            {exception && ["failed", "timed_out"].includes(status) ? (
              <div role="alert" className="min-w-0 rounded-lg bg-danger/5 p-3 text-xs text-danger shadow-sm">
                <div className="mb-2 font-medium">异常信息</div>
                <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap font-mono leading-5 [overflow-wrap:anywhere]" tabIndex={0}>
                  {exception}
                </pre>
              </div>
            ) : null}
            {sessionId && activity.executionId ? (
              <ExecutionLogs
                key={`${sessionId}:${activity.executionId}`}
                sessionId={sessionId}
                executionId={activity.executionId}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  const valueText = json(value);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-subtle shadow-sm">
      <div className="flex min-h-9 items-center justify-between gap-2 px-3">
        <span className="text-xs font-medium text-muted">{label}</span>
        <CopyButton value={valueText} label={`复制${label}`} />
      </div>
      <pre className="m-0 max-h-72 min-w-0 overflow-auto p-3 font-mono text-xs leading-5" tabIndex={0} aria-label={label}>
        {valueText}
      </pre>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1600);
  }
  const feedback = copied ? "已复制" : failed ? "复制失败，请重试" : label;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span role="status" className={`text-xs ${failed ? "text-danger" : "text-muted"}`}>
        {copied || failed ? feedback : ""}
      </span>
      <button
        type="button"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
        aria-label={feedback}
        title={feedback}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}

export function ExecutionLogs({
  sessionId,
  executionId,
}: {
  sessionId: string;
  executionId: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const [text, setText] = useState({ stdout: "", stderr: "" });
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const offsets = { stdout: 0, stderr: 0 };
    const content = { stdout: "", stderr: "" };
    async function poll() {
      try {
        const values = await Promise.all(
          (["stdout", "stderr"] as const).map(async (stream) => ({
            stream,
            value: await readExecutionLogs(
              sessionId,
              executionId,
              stream,
              offsets[stream],
              controller.signal,
            ),
          })),
        );
        if (disposed) return;
        for (const { stream, value } of values) {
          offsets[stream] = value.nextOffset;
          content[stream] += value.text;
          if (value.truncated) setTruncated(true);
        }
        setText({ ...content });
        if (!values.every(({ value }) => value.done))
          timer = setTimeout(() => void poll(), 1000);
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "读取执行日志失败");
      }
    }
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [open, sessionId, executionId]);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
        onClick={() => {
          setText({ stdout: "", stderr: "" });
          setError("");
          setTruncated(false);
          setOpen((v) => !v);
        }}
      >
        {open ? "收起执行日志" : "查看执行日志"}
        <ArrowChevronDown className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open}>
      {open ? (
          <div className="mt-2 min-w-0 space-y-3 rounded-lg bg-subtle p-3 shadow-sm">
            <p className="text-xs text-muted">本地命令 · 当前账户执行</p>
            {error ? (
              <p role="alert" className="text-xs text-danger [overflow-wrap:anywhere]">{error}</p>
            ) : null}
            <pre aria-label="标准输出" tabIndex={0} className="m-0 max-h-72 overflow-auto font-mono text-xs leading-5">
              {text.stdout || "暂无标准输出"}
            </pre>
            {text.stderr ? (
              <pre aria-label="错误输出" tabIndex={0} className="m-0 max-h-72 overflow-auto font-mono text-xs leading-5 text-danger">
                {text.stderr}
              </pre>
            ) : null}
            {truncated ? <p className="text-xs text-warning">日志达到保存上限，部分输出已截断。</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
