"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, SearchField, Typography } from "@heroui/react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  Folder,
  Magnifier,
  ArrowRotateRight,
  Box,
} from "@gravity-ui/icons";
import {
  getAppFieldOutline,
  listApps,
  type ApiFieldOutlineForm,
  type App,
} from "@features/form-designer";
import { appColorToneClass, normalizeAppColorTone } from "../lib/apps";
import { MySurface } from "@shared/ui/MySurface";

type OutlineApp = App & { forms: ApiFieldOutlineForm[] };

export function FieldOutlinePage() {
  const [apps, setApps] = useState<OutlineApp[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedFormIds, setExpandedFormIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedFieldIds, setExpandedFieldIds] = useState<Set<string>>(
    new Set(),
  );
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadOutline = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const { data, error } = await listApps({ responseStyle: "fields" });
      if (error || !data || data.code !== 0 || !data.data)
        throw new Error("load apps failed");

      const appList = data.data;
      const results = await Promise.all(
        appList.map(async (app) => {
          const response = await getAppFieldOutline({
            path: { appId: app.id },
            responseStyle: "fields",
          });
          return {
            ...app,
            forms:
              response.data?.code === 0 && response.data.data
                ? response.data.data.forms
                : [],
          };
        }),
      );
      setApps(results);
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
  const filteredApps = useMemo(
    () =>
      apps
        .map((app) => {
          const matchingForms = normalizedQuery
            ? app.forms.filter((form) =>
                `${form.name} ${form.formUuid} ${form.fields.map((field) => `${field.label} ${field.id}`).join(" ")}`
                  .toLocaleLowerCase()
                  .includes(normalizedQuery),
              )
            : app.forms;
          const appMatches = `${app.name} ${app.id}`
            .toLocaleLowerCase()
            .includes(normalizedQuery);
          return { ...app, forms: appMatches ? app.forms : matchingForms };
        })
        .filter(
          (app) =>
            !normalizedQuery ||
            app.forms.length > 0 ||
            `${app.name} ${app.id}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
        ),
    [apps, normalizedQuery],
  );

  function toggleApp(appId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  }

  function toggleForm(formUuid: string) {
    setExpandedFormIds((current) => {
      const next = new Set(current);
      if (next.has(formUuid)) next.delete(formUuid);
      else next.add(formUuid);
      return next;
    });
  }

  function toggleField(fieldId: string) {
    setExpandedFieldIds((current) => {
      const next = new Set(current);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }

  async function copyId(id: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(id);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = id;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand("copy")) throw new Error("copy failed");
        textarea.remove();
      }
      setCopiedId(id);
      window.setTimeout(
        () => setCopiedId((current) => (current === id ? null : current)),
        1600,
      );
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <div className="theme-page-shell flex h-full min-h-0 overflow-y-auto">
      <main className="flex h-full min-h-0 w-full flex-col gap-4">
        <div className="outline-header flex">
          <Typography type="h4">字段大纲</Typography>
          <Typography
            type="body-sm"
            className="flex items-end gap-1 text-[var(--color-text-secondary)] "
          >
            按应用浏览表单结构与字段设计，快速进入表单设计器继续配置。
          </Typography>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setExpandedIds(new Set(filteredApps.map((app) => app.id)))
              }
              className="h-9 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-medium text-[var(--color-text-on-primary)]"
            >
              展开全部
            </button>
            <button
              type="button"
              onClick={() => setExpandedIds(new Set())}
              className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]"
            >
              收起全部
            </button>
          </div>

          {/* <ArrowRotateRight
            className={`${isLoading ? "animate-spin items-end" : ""}`}
          /> */}

          <SearchField name="search">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                className="w-[280px]"
                placeholder="搜索应用、表单或 UUID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

        </div>

        <div className="min-h-[460px] flex-1">
          {isLoading ? (
            <OutlineLoading />
          ) : errorMessage ? (
            <MessageState
              message={errorMessage}
              actionLabel="重新加载"
              onAction={() => void loadOutline()}
            />
          ) : filteredApps.length === 0 ? (
            <MessageState
              message={
                query ? "未找到匹配的应用或表单。" : "当前还没有可展示的应用。"
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {filteredApps.map((app) => (
                <AppOutlineRow
                  app={app}
                  copiedId={copiedId}
                  expanded={expandedIds.has(app.id) || Boolean(normalizedQuery)}
                  expandedFieldIds={expandedFieldIds}
                  expandedFormIds={expandedFormIds}
                  forceExpandForms={Boolean(normalizedQuery)}
                  key={app.id}
                  onCopy={copyId}
                  onToggle={() => toggleApp(app.id)}
                  onToggleField={toggleField}
                  onToggleForm={toggleForm}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function AppOutlineRow({
  app,
  copiedId,
  expanded,
  expandedFieldIds,
  expandedFormIds,
  forceExpandForms,
  onCopy,
  onToggle,
  onToggleField,
  onToggleForm,
}: {
  app: OutlineApp;
  copiedId: string | null;
  expanded: boolean;
  expandedFieldIds: Set<string>;
  expandedFormIds: Set<string>;
  forceExpandForms: boolean;
  onCopy: (id: string) => void;
  onToggle: () => void;
  onToggleField: (fieldId: string) => void;
  onToggleForm: (formUuid: string) => void;
}) {
  const color = normalizeAppColorTone(app.color);
  return (
    <MySurface className="overflow-hidden">
      <div className="flex min-h-14 items-center gap-2 bg-[var(--color-primary-soft)]/45 px-3 sm:px-4">
        <button
          type="button"
          aria-label={`${expanded ? "收起" : "展开"}${app.name}`}
          onClick={onToggle}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-primary)] hover:bg-[var(--color-control-selected)]"
        >
          <span className="transition-transform">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        </button>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${appColorToneClass[color]}`}
        >
          <Box className="h-5 w-5" />
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <strong className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {app.name}
          </strong>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {app.forms.length} 个表单
          </span>
        </button>
        <CopyButton
          copied={copiedId === app.id}
          id={app.id}
          label="appId"
          onCopy={onCopy}
        />
        <Link
          href={`/${encodeURIComponent(app.id)}`}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]"
        >
          访问应用
        </Link>
      </div>
      {expanded ? (
        <div className="divide-y divide-[var(--color-border)]">
          {app.forms.length ? (
            app.forms.map((form) => (
              <FormOutlineRow
                appId={app.id}
                copiedId={copiedId}
                expanded={
                  expandedFormIds.has(form.formUuid) || forceExpandForms
                }
                expandedFieldIds={expandedFieldIds}
                forceExpandFields={forceExpandForms}
                form={form}
                key={form.formUuid}
                onCopy={onCopy}
                onToggle={() => onToggleForm(form.formUuid)}
                onToggleField={onToggleField}
              />
            ))
          ) : (
            <div className="px-14 py-4 text-sm text-[var(--color-text-secondary)]">
              该应用还没有表单。
            </div>
          )}
        </div>
      ) : null}
    </MySurface>
  );
}

function FormOutlineRow({
  appId,
  copiedId,
  expanded,
  expandedFieldIds,
  forceExpandFields,
  form,
  onCopy,
  onToggle,
  onToggleField,
}: {
  appId: string;
  copiedId: string | null;
  expanded: boolean;
  expandedFieldIds: Set<string>;
  forceExpandFields: boolean;
  form: ApiFieldOutlineForm;
  onCopy: (id: string) => void;
  onToggle: () => void;
  onToggleField: (fieldId: string) => void;
}) {
  return (
    <div>
      <div className="flex min-h-12 items-center gap-2 px-4 pl-12 sm:pl-16">
        <button
          type="button"
          aria-label={`${expanded ? "收起" : "展开"}${form.name}的字段`}
          onClick={onToggle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <File className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <strong className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
            {form.name}
          </strong>
          <span className="block truncate text-[11px] text-[var(--color-text-disabled)]">
            v{form.schemaVersion}
            {form.physicalTable ? ` · ${form.physicalTable}` : ""}
          </span>
        </button>
        <span className="hidden rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)] sm:inline">
          {form.fields.length} 字段
        </span>
        <CopyButton
          copied={copiedId === form.formUuid}
          id={form.formUuid}
          label="formUuid"
          onCopy={onCopy}
        />
        <Link
          href={`/${encodeURIComponent(appId)}/${encodeURIComponent(form.formUuid)}`}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]"
        >
          访问表单
        </Link>
        <Link
          href={`/designer/${form.formUuid}?appId=${encodeURIComponent(appId)}`}
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-[var(--color-primary)] px-2 text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-soft)]"
        >
          设计
        </Link>
      </div>
      {expanded ? (
        <FieldOutlineRows
          copiedId={copiedId}
          expandedFieldIds={expandedFieldIds}
          fields={form.fields}
          forceExpand={forceExpandFields}
          onCopy={onCopy}
          onToggle={onToggleField}
        />
      ) : null}
    </div>
  );
}

function FieldOutlineRows({
  copiedId,
  expandedFieldIds,
  fields,
  forceExpand,
  onCopy,
  onToggle,
}: {
  copiedId: string | null;
  expandedFieldIds: Set<string>;
  fields: ApiFieldOutlineForm["fields"];
  forceExpand: boolean;
  onCopy: (id: string) => void;
  onToggle: (fieldId: string) => void;
}) {
  const knownFieldIds = new Set(fields.map((field) => field.id));
  const childrenByParentId = new Map<string, ApiFieldOutlineForm["fields"]>();
  const rootFields = fields.filter(
    (field) => !field.parentGroupId || !knownFieldIds.has(field.parentGroupId),
  );
  for (const field of fields) {
    if (!field.parentGroupId || !knownFieldIds.has(field.parentGroupId))
      continue;
    childrenByParentId.set(field.parentGroupId, [
      ...(childrenByParentId.get(field.parentGroupId) ?? []),
      field,
    ]);
  }

  return fields.length ? (
    <MySurface variant="tertiary" className="mb-2 mr-2 p-1" style={{ marginLeft: `${3 * 1.5}rem` }}>
      {rootFields.map((field) => (
        <FieldOutlineRow
          copied={copiedId === field.id}
          copiedId={copiedId}
          depth={0}
          expandedFieldIds={expandedFieldIds}
          field={field}
          forceExpand={forceExpand}
          key={field.id}
          childrenByParentId={childrenByParentId}
          onCopy={onCopy}
          onToggle={onToggle}
        />
      ))}
    </MySurface>
  ) : (
    <MySurface variant="tertiary">
      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-panel-soft)]/55 px-20 py-3 text-xs text-[var(--color-text-secondary)] sm:px-24">
        该表单暂未配置字段。
      </div>
    </MySurface>
  );
}

function FieldOutlineRow({
  childrenByParentId,
  copied,
  copiedId,
  depth,
  expandedFieldIds,
  field,
  forceExpand,
  onCopy,
  onToggle,
}: {
  childrenByParentId: Map<string, ApiFieldOutlineForm["fields"]>;
  copied: boolean;
  copiedId: string | null;
  depth: number;
  expandedFieldIds: Set<string>;
  field: ApiFieldOutlineForm["fields"][number];
  forceExpand: boolean;
  onCopy: (id: string) => void;
  onToggle: (fieldId: string) => void;
}) {
  const children = childrenByParentId.get(field.id) ?? [];
  const canExpand = children.length > 0;
  const expanded = forceExpand || expandedFieldIds.has(field.id);
  return (
    <div>
      <div
        className="flex items-center gap-2"
      >
        <button
          type="button"
          aria-label={
            canExpand
              ? `${expanded ? "收起" : "展开"}${field.label}的子字段`
              : undefined
          }
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-text-secondary)] ${canExpand ? "hover:bg-[var(--color-bg-hover)]" : "invisible"}`}
          disabled={!canExpand}
          onClick={() => onToggle(field.id)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
        <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
          {field.label}
        </span>
        {field.componentType === "subform" ? (
          <span className="hidden rounded bg-[var(--color-primary-soft)] px-1.5 py-0.5 text-[11px] text-[var(--color-primary)] sm:inline">
            子表单
          </span>
        ) : null}
        <span className="hidden shrink-0 text-xs text-[var(--color-text-secondary)] sm:inline">
          {field.componentType}
        </span>
        <CopyButton
          copied={copied}
          id={field.id}
          label="FieldUuid"
          onCopy={onCopy}
        />
      </div>
      {canExpand && expanded
        ? children.map((child) => (
            <FieldOutlineRow
              childrenByParentId={childrenByParentId}
              copied={copiedId === child.id}
              copiedId={copiedId}
              depth={depth + 1}
              expandedFieldIds={expandedFieldIds}
              field={child}
              forceExpand={forceExpand}
              key={child.id}
              onCopy={onCopy}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}

function CopyButton({
  copied,
  id,
  label,
  onCopy,
}: {
  copied: boolean;
  id: string;
  label: string;
  onCopy: (id: string) => void;
}) {
  return (
    <button
      type="button"
      title={`复制 ${label}`}
      aria-label={`复制 ${label}`}
      onClick={() => void onCopy(id)}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]"
    >
      <Copy className="h-3.5 w-3.5" />{" "}
      <span className="hidden sm:inline">{copied ? "已复制" : label}</span>
    </button>
  );
}
function OutlineLoading() {
  return (
    <div className="grid grid-cols-1 gap-2">
      {[0, 1, 2, 3].map((item) => (
        <div
          className="h-48 animate-pulse rounded-lg bg-[var(--color-bg-panel-soft)]"
          key={item}
        />
      ))}
    </div>
  );
}
function MessageState({
  actionLabel,
  message,
  onAction,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center p-6 text-center">
      <Folder className="h-8 w-8 text-[var(--color-text-disabled)]" />
      <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
        {message}
      </p>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 text-sm font-medium text-[var(--color-primary)]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
