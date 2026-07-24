"use client";

import { ListBox, Select } from "@heroui/react";
import { useEffect, useMemo, useState, type Key } from "react";
import { listFormRecords } from "../lib/api-client";
import type { RuntimeFieldProps, RuntimeSchemaField } from "./runtime-form-renderer";

type AssociationRecord = {
  id: string;
  data: Record<string, unknown>;
};

const recordsCache = new Map<string, Promise<AssociationRecord[]>>();
const MAX_CACHED_FORMS = 50;

function loadRecords(formId: string) {
  const cached = recordsCache.get(formId);
  if (cached) return cached;

  const request = listFormRecords({
    path: { formUuid: formId },
    query: { page: 1, pageSize: 100 },
    responseStyle: "fields",
  })
    .then(({ data, error }) => {
      if (error || !data || data.code !== 0 || !data.data) {
        throw new Error(data?.message || "无法加载关联记录");
      }

      return data.data.items.map((record) => ({
        id: record.id,
        data: isRecordData(record.data) ? record.data : {},
      }));
    })
    .catch((error) => {
      recordsCache.delete(formId);
      throw error;
    });

  recordsCache.set(formId, request);
  if (recordsCache.size > MAX_CACHED_FORMS) {
    const oldestFormId = recordsCache.keys().next().value;
    if (oldestFormId) recordsCache.delete(oldestFormId);
  }

  return request;
}

function isRecordData(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function RuntimeAssociationField({
  field,
  onChange,
  onFill,
  showLabel = true,
  value,
}: {
  field: RuntimeSchemaField;
  onChange: (value: string) => void;
  onFill: (source: Record<string, unknown>) => void;
  showLabel?: boolean;
  value: unknown;
}) {
  const props = useMemo(() => field.props ?? {}, [field.props]);
  const [records, setRecords] = useState<AssociationRecord[]>([]);
  const selectedId = typeof value === "string" ? value : "";

  useEffect(() => {
    if (!props.associationFormId) return;

    let cancelled = false;
    void loadRecords(props.associationFormId)
      .then((items) => {
        if (!cancelled) setRecords(items);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });

    return () => {
      cancelled = true;
    };
  }, [props.associationFormId]);

  const visibleRecords = useMemo(
    () => applySettings(records, props),
    [props, records],
  );
  const selected = visibleRecords.find((record) => record.id === selectedId);
  const primary = (record: AssociationRecord) =>
    String(record.data[props.associationPrimaryFieldId ?? ""] ?? record.id);
  const secondary = (record: AssociationRecord) =>
    String(record.data[props.associationSecondaryFieldId ?? ""] ?? "");

  const placeholder = props.associationFormId
    ? props.placeholder ?? "请选择"
    : "请先配置关联表单";
  const isLeftTitle = showLabel && props.titlePosition === "left";

  return (
    <div className={isLeftTitle ? "grid h-full w-full min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-start gap-3 pt-7" : showLabel ? "w-full min-w-0 space-y-2" : "w-full min-w-0"}>
      {showLabel ? (
        <label className={isLeftTitle ? "max-w-28 truncate pt-2 text-sm font-medium text-[var(--color-text-primary)]" : "block text-sm font-medium text-[var(--color-text-primary)]"}>
          {field.label}
        </label>
      ) : null}
      <div className={isLeftTitle ? "w-full min-w-0" : undefined}>
      <Select
        aria-label={field.label}
        className="low-code-select-field"
        selectedKey={selectedId || null}
        onSelectionChange={(key: Key | null) => {
          const recordId = key === null ? "" : String(key);
          const record = visibleRecords.find((item) => item.id === recordId);
          onChange(recordId);
          if (record) onFill(record.data);
        }}
        isDisabled={Boolean(props.isDisabled || props.isReadOnly || !props.associationFormId)}
        isRequired={props.isRequired}
        fullWidth
      >
        <Select.Trigger>
          <Select.Value>{selected ? primary(selected) : placeholder}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {visibleRecords.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-[var(--color-text-secondary)]">
                暂无可选记录
              </div>
            ) : visibleRecords.map((record) => (
              <ListBox.Item key={record.id} id={record.id} textValue={primary(record)}>
                <span className="block truncate text-sm">{primary(record)}</span>
                {secondary(record) ? (
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
                    {secondary(record)}
                  </span>
                ) : null}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      </div>
    </div>
  );
}

function applySettings(records: AssociationRecord[], props: RuntimeFieldProps) {
  const filtered = records.filter((record) =>
    (props.associationFilters ?? []).every((filter) => {
      const value = String(record.data[filter.fieldId] ?? "");
      return filter.operator === "contains"
        ? value.includes(filter.value)
        : filter.operator === "neq"
          ? value !== filter.value
          : value === filter.value;
    }),
  );
  const sort = props.associationSorts?.[0];
  if (!sort) return filtered;

  return [...filtered].sort((left, right) => {
    const compared = String(left.data[sort.fieldId] ?? "").localeCompare(
      String(right.data[sort.fieldId] ?? ""),
    );
    return sort.direction === "desc" ? -compared : compared;
  });
}
