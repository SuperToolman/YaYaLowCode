"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@heroui/react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  Folder,
  Magnifier,
  ArrowRotateRight,
} from "@gravity-ui/icons";
import { getAppFieldOutline, listApps, type ApiFieldOutlineForm, type App } from "../../lib/api-client";
import { AppIcon } from "../../components/app-icons";
import { PageHeader } from "../../components/page-header";
import { appColorToneClass, normalizeAppColorTone } from "../../lib/apps";

type OutlineApp = App & { forms: ApiFieldOutlineForm[] };

export function FieldOutlinePage() {
  const [apps, setApps] = useState<OutlineApp[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedFormIds, setExpandedFormIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadOutline = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await listApps({ responseStyle: "fields" });
      if (error || !data || data.code !== 0 || !data.data) throw new Error("load apps failed");

      const appList = data.data;
      const results = await Promise.all(appList.map(async (app) => {
        const response = await getAppFieldOutline({ path: { appId: app.id }, responseStyle: "fields" });
        return { ...app, forms: response.data?.code === 0 && response.data.data ? response.data.data.forms : [] };
      }));
      setApps(results);
      setExpandedIds((current) => current.size ? current : new Set(results.map((app) => app.id)));
    } catch {
      setErrorMessage("字段大纲暂时无法加载，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOutline(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOutline]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredApps = useMemo(() => apps.map((app) => {
    const matchingForms = normalizedQuery
      ? app.forms.filter((form) => `${form.name} ${form.formUuid} ${form.fields.map((field) => `${field.label} ${field.id}`).join(" ")}`.toLocaleLowerCase().includes(normalizedQuery))
      : app.forms;
    const appMatches = `${app.name} ${app.id}`.toLocaleLowerCase().includes(normalizedQuery);
    return { ...app, forms: appMatches ? app.forms : matchingForms };
  }).filter((app) => !normalizedQuery || app.forms.length > 0 || `${app.name} ${app.id}`.toLocaleLowerCase().includes(normalizedQuery)), [apps, normalizedQuery]);

  function toggleApp(appId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(appId)) next.delete(appId); else next.add(appId);
      return next;
    });
  }

  function toggleForm(formUuid: string) {
    setExpandedFormIds((current) => {
      const next = new Set(current);
      if (next.has(formUuid)) next.delete(formUuid); else next.add(formUuid);
      return next;
    });
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1600);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <div className="theme-page-shell flex h-full min-h-0 overflow-y-auto">
      <main className="flex h-full min-h-0 w-full flex-col gap-4">
        <PageHeader title="字段大纲" description="按应用浏览表单结构与字段设计，快速进入表单设计器继续配置。" actions={<button type="button" title="刷新字段大纲" aria-label="刷新字段大纲" onClick={() => void loadOutline()} disabled={isLoading} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-primary)] disabled:opacity-50">
            <ArrowRotateRight className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>} />

        <Card className="theme-panel-strong flex min-h-[460px] flex-1 flex-col overflow-hidden shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => setExpandedIds(new Set(filteredApps.map((app) => app.id)))} className="h-9 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-text-on-primary)]">展开全部</button>
            <button type="button" onClick={() => setExpandedIds(new Set())} className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]">收起全部</button>
            <label className="theme-search-surface flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 sm:ml-auto sm:max-w-md">
              <Magnifier className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
              <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索应用、表单或 UUID" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-disabled)]" />
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? <OutlineLoading /> : errorMessage ? <MessageState message={errorMessage} actionLabel="重新加载" onAction={() => void loadOutline()} /> : filteredApps.length === 0 ? <MessageState message={query ? "未找到匹配的应用或表单。" : "当前还没有可展示的应用。"} /> : (
              <div className="divide-y divide-[var(--color-border)]">
                {filteredApps.map((app) => <AppOutlineRow app={app} copiedId={copiedId} expanded={expandedIds.has(app.id) || Boolean(normalizedQuery)} expandedFormIds={expandedFormIds} forceExpandForms={Boolean(normalizedQuery)} key={app.id} onCopy={copyId} onToggle={() => toggleApp(app.id)} onToggleForm={toggleForm} />)}
              </div>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}

function AppOutlineRow({ app, copiedId, expanded, expandedFormIds, forceExpandForms, onCopy, onToggle, onToggleForm }: { app: OutlineApp; copiedId: string | null; expanded: boolean; expandedFormIds: Set<string>; forceExpandForms: boolean; onCopy: (id: string) => void; onToggle: () => void; onToggleForm: (formUuid: string) => void }) {
  const color = normalizeAppColorTone(app.color);
  return <section>
    <div className="flex min-h-14 items-center gap-2 bg-[var(--color-primary-soft)]/45 px-3 sm:px-4">
      <button type="button" aria-label={`${expanded ? "收起" : "展开"}${app.name}`} onClick={onToggle} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-primary)] hover:bg-[var(--color-control-selected)]"><span className="transition-transform">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span></button>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${appColorToneClass[color]}`}><AppIcon type={app.icon} /></span>
      <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{app.name}</strong><span className="text-xs text-[var(--color-text-secondary)]">{app.forms.length} 个表单</span></button>
      <CopyButton copied={copiedId === app.id} id={app.id} onCopy={onCopy} label="复制应用 ID" />
    </div>
    {expanded ? <div className="divide-y divide-[var(--color-border)]">{app.forms.length ? app.forms.map((form) => <FormOutlineRow appId={app.id} copied={copiedId === form.formUuid} expanded={expandedFormIds.has(form.formUuid) || forceExpandForms} form={form} key={form.formUuid} onCopy={onCopy} onToggle={() => onToggleForm(form.formUuid)} />) : <div className="px-14 py-4 text-sm text-[var(--color-text-secondary)]">该应用还没有表单。</div>}</div> : null}
  </section>;
}

function FormOutlineRow({ appId, copied, expanded, form, onCopy, onToggle }: { appId: string; copied: boolean; expanded: boolean; form: ApiFieldOutlineForm; onCopy: (id: string) => void; onToggle: () => void }) {
  return <div><div className="flex min-h-12 items-center gap-2 px-4 pl-12 sm:pl-16"><button type="button" aria-label={`${expanded ? "收起" : "展开"}${form.name}的字段`} onClick={onToggle} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button><File className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" /><button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left"><strong className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{form.name}</strong><span className="block truncate text-[11px] text-[var(--color-text-disabled)]">草稿 v{form.schemaVersion}{form.physicalTable ? ` · ${form.physicalTable}` : ""}</span></button><span className="hidden rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)] sm:inline">{form.fields.length} 字段</span><CopyButton copied={copied} id={form.formUuid} onCopy={onCopy} label="复制表单 UUID" /><Link href={`/designer/${form.formUuid}?appId=${encodeURIComponent(appId)}`} className="inline-flex h-7 shrink-0 items-center rounded-md border border-[var(--color-primary)] px-2 text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-soft)]">设计</Link></div>{expanded ? <FieldOutlineRows fields={form.fields} /> : null}</div>;
}

function FieldOutlineRows({ fields }: { fields: ApiFieldOutlineForm["fields"] }) {
  return fields.length ? <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-panel-soft)]/55 py-1">{fields.map((field) => <div className="flex min-h-9 items-center gap-2 px-4 pl-20 pr-4 text-sm sm:pl-24" key={field.id}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" /><span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{field.label}</span><span className="hidden shrink-0 text-xs text-[var(--color-text-secondary)] sm:inline">{field.componentType}</span><span className="max-w-[140px] shrink truncate font-mono text-[11px] text-[var(--color-text-disabled)]">{field.id}</span></div>)}</div> : <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-panel-soft)]/55 px-20 py-3 text-xs text-[var(--color-text-secondary)] sm:px-24">该表单暂未配置字段。</div>;
}

function CopyButton({ copied, id, label, onCopy }: { copied: boolean; id: string; label: string; onCopy: (id: string) => void }) { return <button type="button" title={label} aria-label={label} onClick={() => void onCopy(id)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]"><Copy className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{copied ? "已复制" : "UUID"}</span></button>; }
function OutlineLoading() { return <div className="space-y-px p-3">{[0, 1, 2, 3].map((item) => <div className="h-14 animate-pulse rounded-md bg-[var(--color-bg-panel-soft)]" key={item} />)}</div>; }
function MessageState({ actionLabel, message, onAction }: { actionLabel?: string; message: string; onAction?: () => void }) { return <div className="flex min-h-[360px] flex-col items-center justify-center p-6 text-center"><Folder className="h-8 w-8 text-[var(--color-text-disabled)]" /><p className="mt-3 text-sm text-[var(--color-text-secondary)]">{message}</p>{onAction ? <button type="button" onClick={onAction} className="mt-4 text-sm font-medium text-[var(--color-primary)]">{actionLabel}</button> : null}</div>; }
