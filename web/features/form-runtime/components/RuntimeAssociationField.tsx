"use client";
import { evaluateRuleTree } from "@/features/conditions/evaluate";
import { validateRuleTree } from "@/features/conditions";

import { FieldError, Label, ListBox, Select } from "@heroui/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type Key } from "react";
import { fetchAssociationRecords } from "@/features/form-runtime/api";
import type { AssociationRecord } from "@/features/form-runtime/types";
import type { RuntimeFieldProps, RuntimeSchemaField } from "@/features/form-model/runtime-types";

import { RuntimeTransactionContext } from "./runtime-form-transaction";

export const AssociationDefaultsContext = createContext(false);

const recordsCache = new Map<string, Promise<AssociationRecord[]>>();

function loadRecords(formId: string) {
  const cached = recordsCache.get(formId);
  if (cached) return cached;

  const request = fetchAssociationRecords(formId)
    .finally(() => {
      // Share requests only while loading; each new form opening must read fresh records.
      if (recordsCache.get(formId) === request) recordsCache.delete(formId);
    });

  recordsCache.set(formId, request);

  return request;
}

export function RuntimeAssociationField({
  field,
  errorMessage,
  onChange,
  onFill,
  showLabel = true,
  value,
}: {
  field: RuntimeSchemaField;
  errorMessage?: string;
  onChange: (value: string) => void;
  onFill: (source: Record<string, unknown>) => void;
  showLabel?: boolean;
  value: unknown;
}) {
  const transaction = useContext(RuntimeTransactionContext);
  const props = useMemo(() => field.props ?? {}, [field.props]);
  const [records, setRecords] = useState<AssociationRecord[]>([]);
  const allowDefault = useContext(AssociationDefaultsContext);
  const defaultHandled = useRef(false);
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
  useEffect(() => {
    if (selectedId) defaultHandled.current = true;
    if (!allowDefault || defaultHandled.current || props.isDisabled || props.isReadOnly || !props.associationFormId || props.defaultValueType !== "filter" || !props.associationDefaultRules?.length || !records.length) return;
    if (validateRuleTree(props.associationDefaultRules)) return;
    defaultHandled.current = true;
    const record = visibleRecords.reduce<AssociationRecord | undefined>((latest, item) => {
      if (!evaluateRuleTree(props.associationDefaultRules!, item.data)) return latest;
      if (!latest || Date.parse(item.createdAt) > Date.parse(latest.createdAt)) return item;
      return latest;
    }, undefined);
    if (record) transaction(() => { onChange(record.id); onFill(record.data); });
  }, [allowDefault, selectedId, props, records, visibleRecords, onChange, onFill, transaction]);

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
    <div className={isLeftTitle ? "grid h-full w-full min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-start gap-3 pt-7" : "w-full min-w-0"}>
      {showLabel ? (
        <Label isRequired={props.isRequired} className={isLeftTitle ? "max-w-28 truncate pt-2" : "mb-2"}>
          {field.label}
        </Label>
      ) : null}
      <div className={isLeftTitle ? "w-full min-w-0" : undefined}>
      <Select
        aria-label={field.label}
        isInvalid={Boolean(errorMessage)}
        validationBehavior="aria"
        selectedKey={selectedId || null}
        onSelectionChange={(key: Key | null) => {
          const recordId = key === null ? "" : String(key);
          const record = visibleRecords.find((item) => item.id === recordId);
          transaction(() => {
            onChange(recordId);
            if (record) onFill(record.data);
          });
        }}
        isDisabled={Boolean(props.isDisabled || props.isReadOnly || !props.associationFormId)}
        isRequired={props.isRequired}
        fullWidth
      >
        <Select.Trigger className="min-w-0">
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
        <FieldError>{errorMessage}</FieldError>
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
