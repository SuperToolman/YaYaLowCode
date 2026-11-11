"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { formatCountryCityValue, isCountryCityValue } from "@/shared/lib/location-catalog";
import { getCascaderPathByValue, normalizeCascaderDataSource, serializeCascaderLabel } from "@/features/form-model/cascader-data-source";
import { fetchAssociationRecords, fetchRuntimeIdentityCatalog } from "../api";
import type { IdentityUser } from "../types";
import { FormGroup } from "./FormGroup";
import { FormSeparator } from "./FormSeparator";
import { getFormGridTemplateRows } from "./form-grid-layout";
import { RuntimeSubformTable } from "./RuntimeSubformTable";
import type { RuntimeFormRendererProps, RuntimeSchemaField } from "../../form-model/runtime-types";

type DisplayLookup = {
  users: Map<string, IdentityUser>;
  records: Map<string, Map<string, Record<string, unknown>>>;
};
const EMPTY_VALUES: Record<string, unknown> = {};
const EMPTY_LOOKUP: DisplayLookup = { users: new Map(), records: new Map() };

/** Text only: deliberately does not initialize the editing store, defaults or scripts. */
export function RuntimeReadOnlyForm({
  schema,
  values = EMPTY_VALUES,
  valuePatch,
}: {
  schema: RuntimeFormRendererProps["schema"];
  values?: Record<string, unknown>;
  valuePatch?: RuntimeFormRendererProps["valuePatch"];
}) {
  const { token, user, permissions } = useAuth();
  const permissionKey = permissions?.join("\n") ?? "";
  const [lookup, setLookup] = useState<{
    scope: string;
    data: DisplayLookup;
  } | null>(null);
  // Never reuse resolved labels across authentication/permission changes.
  const scope = `${token ?? ""}\n${user?.id ?? ""}\n${permissionKey}`;
  const data = useMemo(
    () => ({ ...values, ...valuePatch?.values }),
    [values, valuePatch],
  );
  const children = useMemo(() => {
    const index = new Map<string, RuntimeSchemaField[]>();
    for (const field of schema.fields) {
      const parent = field.parentGroupId ?? "";
      const list = index.get(parent) ?? [];
      list.push(field);
      index.set(parent, list);
    }
    return index;
  }, [schema.fields]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let needsUsers = false;
    const forms = new Set<string>();
    function inspect(
      parent: string,
      row: Record<string, unknown>,
      ancestors: Set<string>,
    ) {
      for (const field of children.get(parent) ?? []) {
        if (field.props?.isHidden || ancestors.has(field.id)) continue;
        const value = row[field.id];
        const nextAncestors = new Set([...ancestors, field.id]);
        if (field.type === "groupContainer")
          inspect(field.id, row, nextAncestors);
        else if (field.type === "subform" && Array.isArray(value)) {
          for (const item of value)
            if (isRecord(item)) inspect(field.id, item, nextAncestors);
        } else if (!isEmpty(value)) {
          if (field.type === "member") needsUsers = true;
          if (
            field.type === "associationFormField" &&
            field.props?.associationFormId
          )
            forms.add(field.props.associationFormId);
        }
      }
    }
    inspect("", data, new Set());
    const next: DisplayLookup = { users: new Map(), records: new Map() };
    const tasks: Promise<unknown>[] = [];
    if (needsUsers)
      tasks.push(
        fetchRuntimeIdentityCatalog(controller.signal)
          .then((catalog) => {
            next.users = new Map(catalog.users.map((item) => [item.id, item]));
          })
          .catch(() => undefined),
      );
    for (const form of forms)
      tasks.push(
        fetchAssociationRecords(form, controller.signal)
          .then((records) => {
            next.records.set(
              form,
              new Map(records.map((item) => [item.id, item.data])),
            );
          })
          .catch(() => undefined),
      );
    void Promise.all(tasks).then(() => {
      if (!cancelled) setLookup({ scope, data: next });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [children, data, scope]);
  const labels = lookup?.scope === scope ? lookup.data : EMPTY_LOOKUP;

  function fieldValue(
    field: RuntimeSchemaField,
    row: Record<string, unknown>,
    ancestors: Set<string>,
    showLabel = true,
  ): React.ReactNode {
    if (ancestors.has(field.id) || field.props?.isHidden) return null;
    const nested = new Set([...ancestors, field.id]);
    if (field.type === "separator") return <FormSeparator label={field.label} {...field.props} />;
    if (field.type === "groupContainer")
      return (
        <FormGroup
          title={field.label}
          description={field.props?.description}
          groupStyle={field.props?.groupStyle}
          groupTitleType={field.props?.groupTitleType}
        >
          {grid(field.id, row, nested, field)}
        </FormGroup>
      );
    if (field.type === "subform") {
      const columns = (children.get(field.id) ?? [])
        .filter((item) => !item.props?.isHidden)
        .toSorted((a, b) => a.column - b.column || a.row - b.row);
      const value = row[field.id];
      const rows = Array.isArray(value) ? value.filter(isRecord) : [];
      return (
        <section aria-label={field.label} className="min-w-0">
          <div className="mb-2 text-sm font-medium">{field.label}</div>
          <RuntimeSubformTable
            childFields={columns}
            props={field.props ?? {}}
            rows={rows}
            showActions={false}
            emptyState={
              <p className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                暂无子表单数据
              </p>
            }
            renderCell={(child, item) => fieldValue(child, item, nested, false)}
            renderActions={() => null}
          />
        </section>
      );
    }
    const text = formatReadOnlyValue(field, row[field.id], labels);
    return (
      <div
        className={
          field.props?.titlePosition === "left" && showLabel
            ? "flex min-w-0 items-start gap-3"
            : "min-w-0"
        }
      >
        {showLabel && (
          <div className="mb-2 shrink-0 text-sm text-[var(--color-text-secondary)]">
            {field.label}
          </div>
        )}
        <div
          aria-label={field.label}
          className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]"
        >
          {text}
        </div>
      </div>
    );
  }
  function grid(
    parent: string,
    row: Record<string, unknown>,
    ancestors: Set<string>,
    container?: RuntimeSchemaField,
  ): React.ReactNode {
    const visibleFields = (children.get(parent) ?? []).filter(
      (field) => !field.props?.isHidden && !ancestors.has(field.id),
    );
    return (
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns: `repeat(${container?.colSpan ?? schema.columns}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(68px, auto)",
          gridTemplateRows: getFormGridTemplateRows(visibleFields, container?.row ?? 0),
          columnGap: 16,
          rowGap: 20,
        }}
      >
        {visibleFields.map((field) => (
            <div
              key={field.id}
              className={field.type === "separator" ? "flex min-w-0" : "min-w-0"}
              style={{
                gridColumn: `${field.column - (container?.column ?? 0) + 1} / span ${field.colSpan ?? 1}`,
                gridRow: `${field.row - (container?.row ?? 0) + 1} / span ${field.rowSpan ?? 1}`,
              }}
            >
              {fieldValue(field, row, ancestors)}
            </div>
          ))}
      </div>
    );
  }
  return <div data-read-only-display="true">{grid("", data, new Set())}</div>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isEmpty(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && (!value.length || value.every(isEmpty)))
  );
}
function textValue(value: unknown): string {
  if (isEmpty(value)) return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(textValue).join("、");
  if (isRecord(value)) {
    for (const key of ["displayName", "label", "name"])
      if (typeof value[key] === "string") return textValue(value[key]);
    return JSON.stringify(value);
  }
  return String(value);
}
function richText(value: unknown): string {
  if (!isRecord(value)) return typeof value === "string" ? value : "";
  if (typeof value.text === "string") return value.text;
  if (value.type === "hardBreak") return "\n";
  const text = Array.isArray(value.content)
    ? value.content.map(richText).join("")
    : "";
  return ["paragraph", "heading", "listItem", "tableRow"].includes(
    String(value.type),
  )
    ? `${text}\n`
    : text;
}
export function formatReadOnlyValue(
  field: RuntimeSchemaField,
  value: unknown,
  lookup: DisplayLookup = EMPTY_LOOKUP,
): string {
  if (field.type === "description")
    return textValue(value ?? field.props?.description);
  if (isEmpty(value)) return "-";
  if (field.type === "richText") return richText(value).trim() || "-";
  if (isCountryCityValue(value)) return formatCountryCityValue(value);
  if (field.type === "dateRange" && Array.isArray(value))
    return value.map(textValue).join(" 至 ");
  if (field.type === "cascader" && typeof value === "string") {
    const path = getCascaderPathByValue(
      normalizeCascaderDataSource(field.props?.dataSource),
      value,
    );
    return path.length ? serializeCascaderLabel(path) : value;
  }
  if (field.type === "associationFormField" && typeof value === "string") {
    const record = lookup.records
      .get(field.props?.associationFormId ?? "")
      ?.get(value);
    return record
      ? textValue(record[field.props?.associationPrimaryFieldId ?? ""] ?? value)
      : value;
  }
  if (field.type === "member") {
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map((id) => {
        const user = lookup.users.get(String(id));
        if (!user) return textValue(id);
        if (field.props?.memberDisplayFormat === "nameJobNumber")
          return `${user.displayName}(${user.jobNumber || "-"})`;
        if (field.props?.memberDisplayFormat === "nameUserId")
          return `${user.displayName}(${user.id})`;
        return user.displayName;
      })
      .join("、");
  }
  const options = field.props?.options;
  if (options?.length) {
    const optionText = (item: unknown) =>
      options.find((option) => option.value === String(item))?.label ??
      textValue(item);
    return Array.isArray(value)
      ? value.map(optionText).join("、")
      : optionText(value);
  }
  return textValue(value);
}
