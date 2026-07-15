"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, Key } from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  DateRangePicker,
  Input,
  InputGroup,
  Link as HeroLink,
  ListBox,
  NumberField,
  Radio,
  RadioGroup,
  RangeCalendar,
  Select,
  toast,
} from "@heroui/react";
import { DateInputGroup } from "@heroui/react/date-input-group";
import { Description } from "@heroui/react/description";
import { parseDate } from "@internationalized/date";
import { normalizeActionPanelCode } from "../lib/action-panel-code";
import { calculateFormulaValues } from "../lib/form-formula";
import { TrashIcon } from "./app-icons";

const DEFAULT_COLUMN_GAP = 16;
const DEFAULT_ROW_GAP = 20;
const DEFAULT_OPTIONS: RuntimeFieldOption[] = [
  { label: "选项一", value: "选项一" },
  { label: "选项二", value: "选项二" },
];
const DEFAULT_MEMBER_OPTIONS: RuntimeFieldOption[] = [
  { label: "张三", value: "zhangsan" },
  { label: "李四", value: "lisi" },
  { label: "王五", value: "wangwu" },
];
const DEFAULT_DEPARTMENT_OPTIONS: RuntimeFieldOption[] = [
  { label: "产品部", value: "product" },
  { label: "研发部", value: "engineering" },
  { label: "运营部", value: "operations" },
];
let runtimeDebugEventSequence = 0;
const recentDidMountExecutions = new Map<string, number>();
const DID_MOUNT_DEDUP_WINDOW_MS = 2000;

export type RuntimeFieldType =
  | "groupContainer"
  | "subform"
  | "singleLineText"
  | "description"
  | "multiLineText"
  | "number"
  | "radio"
  | "checkbox"
  | "select"
  | "multiSelect"
  | "link"
  | "date"
  | "dateRange"
  | "attachment"
  | "imageUpload"
  | "member"
  | "department"
  | "button";

export type RuntimeFieldOption = {
  label: string;
  value: string;
};

export type RuntimeFieldProps = {
  placeholder?: string;
  description?: string;
  defaultValueType?: "custom" | "formula" | "linkage";
  defaultValue?: string | number | string[];
  defaultValueFormula?: string;
  defaultValueLinkage?: string;
  isDisabled?: boolean;
  isHidden?: boolean;
  isReadOnly?: boolean;
  isRequired?: boolean;
  showClearButton?: boolean;
  showCounter?: boolean;
  minValue?: number;
  maxValue?: number;
  step?: number;
  rows?: number;
  options?: RuntimeFieldOption[];
  orientation?: "horizontal" | "vertical";
  href?: string;
  target?: "_self" | "_blank";
  buttonText?: string;
  accept?: string;
  multiple?: boolean;
  subformAddButtonText?: string;
  subformButtonState?: "normal" | "disabled" | "hidden";
  subformAllowBatchImport?: boolean;
  subformAllowExcelExport?: boolean;
  subformAllowBatchDelete?: boolean;
  subformFilterEmptyRows?: boolean;
  subformShowActionColumn?: boolean;
  subformShowCopyButton?: boolean;
  subformShowDeleteButton?: boolean;
  subformDeleteButtonText?: string;
  subformConfirmDelete?: boolean;
  subformShowSort?: boolean;
  subformDisplayMode?: "desktop" | "mobile";
  subformArrangement?: "tile" | "table";
  subformTheme?: "zebra" | "divider" | "border";
  subformShowHeader?: boolean;
  subformShowIndex?: boolean;
  subformLayoutMode?: "auto" | "fixed";
  subformPageSize?: number;
  subformMaxRows?: number;
  subformFrozenLeftColumns?: number;
  subformFreezeActionColumn?: boolean;
  subformActionColumnWidth?: number;
  subformAllowCustomColumns?: boolean;
  subformEnableTotals?: boolean;
};

export type RuntimeSchemaField = {
  id: string;
  type: RuntimeFieldType;
  label: string;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
  parentGroupId?: string | null;
  props?: RuntimeFieldProps;
};

export type RuntimeDataSource = {
  id: string;
  name: string;
  kind: "string" | "number" | "boolean" | "object";
  initialValue: string;
  description?: string;
};

export type RuntimeFieldAction = {
  id: string;
  fieldId: string;
  eventName: string;
  script: string;
};

export type RuntimeActionPanelState = {
  code: string;
  didMount?: string;
  onSubmit?: string;
  fieldEvents?: RuntimeFieldAction[];
};

export type RuntimePageProps = {
  submitButtonText?: string;
  dataSources?: RuntimeDataSource[];
  actionPanel?: Partial<RuntimeActionPanelState>;
  agent?: {
    enabled?: boolean;
    agentId?: string;
    prompt?: string;
    context?: {
      generated?: string;
      overrides?: string;
      generatedAt?: string;
      sourceHash?: string;
      status?: "idle" | "analyzing" | "ready" | "stale" | "failed";
      error?: string;
    };
  };
};

export type RuntimeFormSchema = {
  formUuid: string;
  formName?: string;
  columns: number;
  rows: number;
  fields: RuntimeSchemaField[];
  pageProps?: RuntimePageProps;
};

type RuntimeFormRendererProps = {
  schema: RuntimeFormSchema;
  submitLabel: string;
  submitting?: boolean;
  showSubmitButton?: boolean;
  initialValues?: Record<string, unknown>;
  urlParams?: Record<string, string>;
  onDebugEvent?: (event: RuntimeDebugEvent) => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
  valuePatch?: { id: number; values: Record<string, unknown> };
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
};

export type RuntimeDebugEvent = {
  id: string;
  type: "didMount" | "field" | "submit";
  fieldId?: string;
  eventName: string;
  status: "success" | "error";
  message: string;
  result?: string;
  createdAt: string;
};

type RuntimeRendererState = {
  values: Record<string, unknown>;
  dataSources: Record<string, unknown>;
  formulaErrors: Record<string, string>;
  debugEvent?: RuntimeDebugEvent;
};

export function RuntimeFormRenderer({
  schema,
  submitLabel,
  submitting = false,
  showSubmitButton = true,
  initialValues,
  urlParams = {},
  onDebugEvent,
  onValuesChange,
  valuePatch,
  onSubmit,
}: RuntimeFormRendererProps) {
  const didMountExecutedRef = useRef(false);
  const emittedDebugEventIdRef = useRef<string | null>(null);
  const fields = useMemo(
    () => schema.fields.map((field) => ({ ...field, parentGroupId: field.parentGroupId ?? null })),
    [schema.fields],
  );
  const normalizedActionCode = useMemo(
    () => normalizeActionPanelCode(schema.pageProps?.actionPanel),
    [schema.pageProps?.actionPanel],
  );
  const [runtimeState, setRuntimeState] = useState<RuntimeRendererState>(() =>
    buildInitialRuntimeState(
      fields,
      schema.pageProps?.dataSources,
      initialValues,
    ),
  );
  const values = runtimeState.values;

  useEffect(() => {
    onValuesChange?.(runtimeState.values);
  }, [onValuesChange, runtimeState.values]);

  useEffect(() => {
    if (!valuePatch) return;
    setRuntimeState((current) => {
      const nextValues = { ...current.values, ...valuePatch.values };
      const calculated = calculateFormulaValues(fields, nextValues);
      return {
        ...current,
        values: calculated.values,
        formulaErrors: calculated.errors,
      };
    });
  }, [fields, valuePatch]);
  const dataSources = runtimeState.dataSources;
  const actionModule = useMemo(
    () => compileActionModule(normalizedActionCode),
    [normalizedActionCode],
  );
  const didMountExecutionKey = useMemo(
    () =>
      JSON.stringify({
        formUuid: schema.formUuid,
        didMount: normalizedActionCode,
        urlParams,
      }),
    [normalizedActionCode, schema.formUuid, urlParams],
  );

  useEffect(() => {
    if (
      runtimeState.debugEvent &&
      runtimeState.debugEvent.id !== emittedDebugEventIdRef.current
    ) {
      emittedDebugEventIdRef.current = runtimeState.debugEvent.id;
      onDebugEvent?.(runtimeState.debugEvent);
    }
  }, [onDebugEvent, runtimeState.debugEvent]);

  useEffect(() => {
    if (didMountExecutedRef.current) {
      return;
    }

    didMountExecutedRef.current = true;

    if (!actionModule.handlers.didMount) {
      if (actionModule.error) {
        const nextDebugEvent: RuntimeDebugEvent = {
          id: createRuntimeDebugEventId(),
          type: "didMount",
          eventName: "didMount",
          status: "error",
          message: actionModule.error,
          createdAt: new Date().toISOString(),
        };

        window.setTimeout(() => {
          setRuntimeState((current) => ({
            ...current,
            debugEvent: nextDebugEvent,
          }));
        }, 0);
        toast.danger("页面加载动作执行失败", {
          description: actionModule.error,
        });
      }
      return;
    }

    if (shouldDeduplicateDidMountExecution(didMountExecutionKey)) {
      return;
    }

    window.setTimeout(() => {
      setRuntimeState((current) => {
        const nextValues = { ...current.values };
        const nextDataSources = { ...current.dataSources };
        let didMountErrorMessage = "";
        const result = runActionHandler({
          actionModule,
          handlerName: "didMount",
          fieldId: "",
          eventName: "didMount",
          dataSources: nextDataSources,
          onError: (message) =>
            toast.danger("页面加载动作执行失败", {
              description: message,
            }),
          onSuccess: () => undefined,
          onErrorEvent: (message) => {
            didMountErrorMessage = message;
          },
          urlParams,
          value: undefined,
          values: nextValues,
        });

        const calculated = calculateFormulaValues(fields, nextValues);
        return {
          values: calculated.values,
          dataSources: nextDataSources,
          formulaErrors: calculated.errors,
          debugEvent: {
            id: createRuntimeDebugEventId(),
            type: "didMount",
            eventName: "didMount",
            status: didMountErrorMessage ? "error" : "success",
            message: didMountErrorMessage || "页面加载动作执行成功",
            result: didMountErrorMessage ? undefined : stringifyDebugValue(result ?? nextValues),
            createdAt: new Date().toISOString(),
          },
        };
      });
    }, 0);
  }, [actionModule, didMountExecutionKey, fields, urlParams]);

  const visibleRootFields = useMemo(
    () =>
      fields
        .filter((field) => !field.props?.isHidden && !field.parentGroupId)
        .sort((left, right) => left.row - right.row || left.column - right.column),
    [fields],
  );
  const descriptionRows = useMemo(
    () =>
      new Set(
        visibleRootFields
          .filter((field) => field.props?.description?.trim())
          .map((field) => field.row),
      ),
    [visibleRootFields],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitValues = calculateFormulaValues(fields, values).values;
    const submitDataSources = { ...dataSources };
    const result = runActionHandler({
      actionModule,
      handlerName: "onSubmit",
      fieldId: "",
      eventName: "onSubmit",
      dataSources: submitDataSources,
      onError: (message) =>
        toast.danger("表单动作执行失败", {
          description: message,
        }),
      onSuccess: (output) =>
        onDebugEvent?.({
          id: createRuntimeDebugEventId(),
          type: "submit",
          eventName: "onSubmit",
          status: "success",
          message: "提交动作执行成功",
          result: stringifyDebugValue(output ?? submitValues),
          createdAt: new Date().toISOString(),
        }),
      onErrorEvent: (message) =>
        onDebugEvent?.({
          id: createRuntimeDebugEventId(),
          type: "submit",
          eventName: "onSubmit",
          status: "error",
          message,
          createdAt: new Date().toISOString(),
        }),
      urlParams,
      value: undefined,
      values: submitValues,
    });

    const calculatedSubmit = calculateFormulaValues(fields, submitValues);
    setRuntimeState({
      values: calculatedSubmit.values,
      dataSources: submitDataSources,
      formulaErrors: calculatedSubmit.errors,
      debugEvent: undefined,
    });

    const payload =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : calculatedSubmit.values;

    await onSubmit(payload);
  }

  function setFieldValue(fieldId: string, nextValue: unknown, eventName = "onChange") {
    const nextValues = { ...values, [fieldId]: nextValue };
    const nextDataSources = { ...dataSources };
    runActionHandler({
      actionModule,
      handlerName: "onFieldEvent",
      fieldId,
      eventName,
      dataSources: nextDataSources,
      onError: (message) =>
        toast.danger("组件事件执行失败", {
          description: `${fieldId} / ${eventName}: ${message}`,
        }),
      onSuccess: (output) =>
        onDebugEvent?.({
          id: createRuntimeDebugEventId(),
          type: "field",
          fieldId,
          eventName,
          status: "success",
          message: "组件事件执行成功",
          result: stringifyDebugValue(output ?? nextValues[fieldId]),
          createdAt: new Date().toISOString(),
        }),
      onErrorEvent: (message) =>
        onDebugEvent?.({
          id: createRuntimeDebugEventId(),
          type: "field",
          fieldId,
          eventName,
          status: "error",
          message,
          createdAt: new Date().toISOString(),
        }),
      urlParams,
      value: nextValue,
      values: nextValues,
    });

    const calculated = calculateFormulaValues(fields, nextValues);
    setRuntimeState({
      values: calculated.values,
      dataSources: nextDataSources,
      formulaErrors: calculated.errors,
      debugEvent: undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${schema.columns}, minmax(0, 1fr))`,
          columnGap: DEFAULT_COLUMN_GAP,
          rowGap: DEFAULT_ROW_GAP,
        }}
      >
        {visibleRootFields.map((field) => (
          <div
            key={field.id}
            className={[
              "flex min-w-0",
              isTopAlignedRuntimeField(field.type) || descriptionRows.has(field.row)
                ? "items-start"
                : "items-end",
            ].join(" ")}
            style={{
              gridColumn: `${field.column + 1} / span ${field.colSpan ?? 1}`,
              gridRow: `${field.row + 1} / span ${field.rowSpan ?? 1}`,
            }}
          >
            <RuntimeFieldNode
              allFields={fields}
              field={field}
              formulaErrors={runtimeState.formulaErrors}
              value={values[field.id]}
              values={values}
              onFieldAction={setFieldValue}
            />
          </div>
        ))}
      </div>

      {showSubmitButton ? (
        <div className="mt-8 flex justify-end">
          <Button
            type="submit"
            isDisabled={submitting}
            className="bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]"
          >
            {submitting ? "提交中..." : submitLabel}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function RuntimeFieldNode({
  allFields,
  field,
  formulaErrors,
  onFieldAction,
  value,
  values,
}: {
  allFields: RuntimeSchemaField[];
  field: RuntimeSchemaField;
  formulaErrors: Record<string, string>;
  onFieldAction: (fieldId: string, nextValue: unknown, eventName?: string) => void;
  value: unknown;
  values: Record<string, unknown>;
}) {
  if (field.type === "subform") {
    const childFields = allFields
      .filter((item) => item.parentGroupId === field.id && !item.props?.isHidden)
      .sort((left, right) => left.column - right.column);
    return <RuntimeSubform field={field} childFields={childFields} value={value} onChange={(nextValue) => onFieldAction(field.id, nextValue, "onChange")} />;
  }

  if (field.type === "groupContainer") {
    const childFields = allFields
      .filter((item) => item.parentGroupId === field.id && !item.props?.isHidden)
      .sort((left, right) => left.row - right.row || left.column - right.column);

    return (
      <div className="flex w-full min-w-0 flex-col rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-1">
        <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{field.label}</div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${field.colSpan ?? 1}, minmax(0, 1fr))`,
            columnGap: 12,
            rowGap: 14,
          }}
        >
          {childFields.map((child) => (
            <div
              key={child.id}
              className={[
                "flex min-w-0",
                isTopAlignedRuntimeField(child.type) ? "items-start" : "items-end",
              ].join(" ")}
              style={{
                gridColumn: `${child.column - field.column + 1} / span ${child.colSpan ?? 1}`,
                gridRow: `${child.row - field.row + 1} / span ${child.rowSpan ?? 1}`,
              }}
            >
              <RuntimeFieldNode
                allFields={allFields}
                field={child}
                formulaErrors={formulaErrors}
                onFieldAction={onFieldAction}
                value={values[child.id]}
                values={values}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <FormField
      field={field}
      formulaError={formulaErrors[field.id]}
      onFieldAction={onFieldAction}
      value={value}
    />
  );
}

function RuntimeSubform({ field, childFields, value, onChange }: { field: RuntimeSchemaField; childFields: RuntimeSchemaField[]; value: unknown; onChange: (value: Array<Record<string, unknown>>) => void }) {
  const props = field.props ?? {};
  const rows = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  const maxRows = props.subformMaxRows ?? 500;
  const showActions = true;

  function updateCell(rowIndex: number, fieldId: string, nextValue: unknown) {
    onChange(rows.map((row, index) => index === rowIndex ? { ...row, [fieldId]: nextValue } : row));
  }

  function addRow() {
    if (rows.length >= maxRows || props.subformButtonState !== "normal") return;
    onChange([...rows, Object.fromEntries(childFields.map((child) => [child.id, getFieldDefaultValue(child)]))]);
  }

  function removeRow(rowIndex: number) {
    if (props.subformConfirmDelete !== false && !window.confirm("确认删除这一行吗？")) return;
    onChange(rows.filter((_, index) => index !== rowIndex));
  }

  function copyRow(rowIndex: number) {
    if (rows.length >= maxRows) return;
    onChange([...rows.slice(0, rowIndex + 1), { ...rows[rowIndex] }, ...rows.slice(rowIndex + 1)]);
  }

  function moveRow(rowIndex: number, direction: -1 | 1) {
    const targetIndex = rowIndex + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const nextRows = [...rows];
    [nextRows[rowIndex], nextRows[targetIndex]] = [nextRows[targetIndex], nextRows[rowIndex]];
    onChange(nextRows);
  }

  return (
    <section className="w-full min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-sm font-semibold">{field.label}</div>{props.description ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{props.description}</p> : null}</div>
        <div className="flex flex-wrap gap-2">
          {props.subformAllowBatchImport ? <Button size="sm" variant="secondary" isDisabled>批量导入</Button> : null}
          {props.subformAllowExcelExport ? <Button size="sm" variant="secondary" isDisabled={rows.length === 0}>导出 Excel</Button> : null}
          {props.subformButtonState !== "hidden" ? <Button size="sm" isDisabled={props.subformButtonState === "disabled" || rows.length >= maxRows} onPress={addRow}>{props.subformAddButtonText ?? "新增一项"}</Button> : null}
        </div>
      </div>
      <div className={`subform-horizontal-scroll overflow-x-auto rounded-xl border border-[var(--color-border)] ${props.subformTheme === "border" ? "divide-y divide-[var(--color-border)]" : ""}`}>
        <table
          className="w-full border-collapse text-left text-sm"
          style={{
            tableLayout: props.subformLayoutMode === "auto" ? "auto" : "fixed",
            minWidth: Math.max(
              720,
              childFields.length * 180 +
                (props.subformShowIndex !== false ? 56 : 0) +
                (showActions ? props.subformActionColumnWidth ?? 70 : 0),
            ),
          }}
        >
          {props.subformShowHeader !== false ? <thead className="bg-[var(--color-bg-subtle)]"><tr>{props.subformShowIndex !== false ? <th className="w-14 px-3 py-2 text-center font-medium">序号</th> : null}{childFields.map((child) => <th key={child.id} className="px-3 py-2 font-medium">{child.label}</th>)}{showActions ? <th className="sticky right-0 z-20 border-l border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-center font-medium shadow-[-6px_0_12px_-10px_rgba(15,23,42,0.7)]" style={{ width: props.subformActionColumnWidth ?? 70, minWidth: props.subformActionColumnWidth ?? 70 }}>操作</th> : null}</tr></thead> : null}
          <tbody>
            {rows.map((row, rowIndex) => <tr key={rowIndex} className={props.subformTheme === "zebra" && rowIndex % 2 === 1 ? "bg-[var(--color-bg-subtle)]" : "border-t border-[var(--color-border)]"}>{props.subformShowIndex !== false ? <td className="px-3 py-2 text-center text-[var(--color-text-secondary)]">{rowIndex + 1}</td> : null}{childFields.map((child) => <td key={child.id} className="min-w-36 px-2 py-2 align-top"><FormField field={child} value={row[child.id]} showLabel={false} onFieldAction={(_, nextValue) => updateCell(rowIndex, child.id, nextValue)} /></td>)}{showActions ? <td className="sticky right-0 z-10 border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-2 align-middle shadow-[-6px_0_12px_-10px_rgba(15,23,42,0.7)]"><div className="flex items-center justify-center gap-1">{props.subformShowSort ? <><Button isIconOnly size="sm" variant="ghost" aria-label="上移" onPress={() => moveRow(rowIndex, -1)}>↑</Button><Button isIconOnly size="sm" variant="ghost" aria-label="下移" onPress={() => moveRow(rowIndex, 1)}>↓</Button></> : null}{props.subformShowCopyButton ? <Button size="sm" variant="ghost" onPress={() => copyRow(rowIndex)}>复制</Button> : null}{props.subformShowDeleteButton !== false ? <Button isIconOnly size="sm" variant="ghost" className="text-[var(--color-danger)]" aria-label={props.subformDeleteButtonText ?? "删除"} onPress={() => removeRow(rowIndex)}><TrashIcon /></Button> : null}</div></td> : null}</tr>)}
            {rows.length === 0 ? <tr><td className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]" colSpan={childFields.length + (props.subformShowIndex !== false ? 1 : 0) + (showActions ? 1 : 0)}>暂无子表单数据，点击“{props.subformAddButtonText ?? "新增一项"}”开始填写。</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-xs text-[var(--color-text-secondary)]"><span>共 {rows.length} 行</span><span>最多 {maxRows} 行 · 每页 {props.subformPageSize ?? 20} 行</span></div>
    </section>
  );
}

function FormField({
  field,
  formulaError,
  onFieldAction,
  showLabel = true,
  value,
}: {
  field: RuntimeSchemaField;
  formulaError?: string;
  onFieldAction: (fieldId: string, nextValue: unknown, eventName?: string) => void;
  showLabel?: boolean;
  value: unknown;
}) {
  const props = {
    ...(field.props ?? {}),
    isReadOnly:
      field.props?.defaultValueType === "formula" ? true : field.props?.isReadOnly,
  };
  const placeholder = props.placeholder ?? "请输入";
  const options = normalizeFieldOptions(props.options, field.type);
  const textValue =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : typeof props.defaultValue === "string"
          ? props.defaultValue
          : "";
  const multiValues = Array.isArray(value) ? (value as string[]) : Array.isArray(props.defaultValue) ? props.defaultValue : [];
  const numberValue =
    typeof value === "number"
      ? value
      : toOptionalNumber(value as string | number | string[] | undefined) ??
        toOptionalNumber(props.defaultValue);
  const description = props.description?.trim();
  const orientation =
    field.type === "radio" || field.type === "checkbox"
      ? "horizontal"
      : (props.orientation ?? "vertical");

  return (
    <div className="w-full min-w-0 flex-1 space-y-2">
      {showLabel && field.type !== "button" ? (
        <label className="block text-sm font-medium text-[var(--color-text-primary)]" htmlFor={field.id}>
          {field.label}
        </label>
      ) : null}
      {field.type === "singleLineText" ? (
        <div className="relative">
          <Input
            id={field.id}
            aria-label={field.label}
            disabled={props.isDisabled}
            placeholder={placeholder}
            readOnly={props.isReadOnly}
            required={props.isRequired}
            value={textValue}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onFieldAction(field.id, event.currentTarget.value, "onChange")
            }
            fullWidth
          />
          {props.showClearButton ? (
            <RuntimeClearButton
              isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
              onClear={() => onFieldAction(field.id, "", "onChange")}
            />
          ) : null}
          {props.showCounter ? <Counter value={textValue} /> : null}
        </div>
      ) : null}
      {field.type === "description" ? (
        <p className="rounded-xl bg-[var(--color-bg-subtle)] px-3 py-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          {textValue || placeholder}
        </p>
      ) : null}
      {field.type === "multiLineText" ? (
        <div className="relative">
          <InputGroup fullWidth>
            <InputGroup.TextArea
              id={field.id}
              aria-label={field.label}
              disabled={props.isDisabled}
              placeholder={placeholder}
              readOnly={props.isReadOnly}
              required={props.isRequired}
              rows={props.rows ?? Math.max(2, field.rowSpan ?? 1)}
              value={textValue}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                onFieldAction(field.id, event.currentTarget.value, "onChange")
              }
            />
          </InputGroup>
          {props.showClearButton ? (
            <RuntimeClearButton
              isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
              onClear={() => onFieldAction(field.id, "", "onChange")}
            />
          ) : null}
          {props.showCounter ? <Counter value={textValue} /> : null}
        </div>
      ) : null}
      {field.type === "number" ? (
        <NumberField
          aria-label={field.label}
          className="low-code-number-field"
          value={numberValue}
          onChange={(nextValue) => onFieldAction(field.id, nextValue ?? "", "onChange")}
          isDisabled={props.isDisabled}
          isReadOnly={props.isReadOnly}
          isRequired={props.isRequired}
          maxValue={props.maxValue}
          minValue={props.minValue}
          step={props.step}
          fullWidth
        >
          <NumberField.Group>
            <NumberField.DecrementButton>-</NumberField.DecrementButton>
            <NumberField.Input id={field.id} placeholder={placeholder} />
            <NumberField.IncrementButton>+</NumberField.IncrementButton>
          </NumberField.Group>
        </NumberField>
      ) : null}
      {field.type === "radio" ? (
        <RadioGroup
          aria-label={field.label}
          className={[
            "low-code-choice-field",
            orientation === "horizontal" ? "low-code-choice-horizontal" : "low-code-choice-vertical",
          ].join(" ")}
          value={textValue}
          onChange={(nextValue) => onFieldAction(field.id, nextValue, "onChange")}
          isDisabled={props.isDisabled}
          isReadOnly={props.isReadOnly}
          isRequired={props.isRequired}
        >
          {options.map((option) => (
            <Radio key={option.value} value={option.value}>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              <Radio.Content className="text-[12px]">{option.label}</Radio.Content>
            </Radio>
          ))}
        </RadioGroup>
      ) : null}
      {field.type === "checkbox" ? (
        <CheckboxGroup
          aria-label={field.label}
          className={[
            "low-code-choice-field",
            orientation === "horizontal" ? "low-code-choice-horizontal" : "low-code-choice-vertical",
          ].join(" ")}
          value={multiValues}
          onChange={(nextValue) => onFieldAction(field.id, nextValue, "onChange")}
          isDisabled={props.isDisabled}
          isReadOnly={props.isReadOnly}
          isRequired={props.isRequired}
        >
          {options.map((option) => (
            <Checkbox key={option.value} value={option.value}>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content className="text-[12px]">{option.label}</Checkbox.Content>
            </Checkbox>
          ))}
        </CheckboxGroup>
      ) : null}
      {field.type === "select" || field.type === "member" || field.type === "department" ? (
        <RuntimeSelect
          field={field}
          options={options}
          placeholder={placeholder}
          props={props}
          value={textValue}
          onChange={(nextValue) => onFieldAction(field.id, nextValue, "onChange")}
        />
      ) : null}
      {field.type === "multiSelect" ? (
        <RuntimeMultiSelect
          field={field}
          options={options}
          placeholder={placeholder}
          props={props}
          value={multiValues}
          onChange={(nextValue) => onFieldAction(field.id, nextValue, "onChange")}
        />
      ) : null}
      {field.type === "link" ? (
        <HeroLink href={props.href || "#"} target={props.target}>
          {textValue || field.label}
        </HeroLink>
      ) : null}
      {field.type === "date" ? (
        <Input
          id={field.id}
          aria-label={field.label}
          disabled={props.isDisabled}
          placeholder={placeholder}
          readOnly={props.isReadOnly}
          required={props.isRequired}
          type="date"
          value={textValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFieldAction(field.id, event.currentTarget.value, "onChange")
          }
          fullWidth
        />
      ) : null}
      {field.type === "dateRange" ? (
        <RuntimeDateRangePicker
          field={field}
          props={props}
          value={multiValues}
          onChange={(nextValue) => onFieldAction(field.id, nextValue, "onChange")}
        />
      ) : null}
      {field.type === "attachment" || field.type === "imageUpload" ? (
        <RuntimeUpload field={field} props={props} />
      ) : null}
      {field.type === "button" ? (
        <Button
          type="button"
          isDisabled={props.isDisabled}
          onPress={() => {
            onFieldAction(field.id, value ?? "", "onClick");
          }}
        >
          {props.buttonText || field.label}
        </Button>
      ) : null}
      {description ? <Description className="text-sm text-[var(--color-text-secondary)]">{description}</Description> : null}
      {formulaError ? (
        <Description className="text-sm text-[var(--color-danger)]">
          公式错误：{formulaError}
        </Description>
      ) : null}
    </div>
  );
}

function RuntimeSelect({
  field,
  onChange,
  options,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  onChange: (value: string) => void;
  options: RuntimeFieldOption[];
  placeholder: string;
  props: RuntimeFieldProps;
  value: string;
}) {
  return (
    <Select
      aria-label={field.label}
      className="low-code-select-field"
      selectedKey={value || null}
      onSelectionChange={(key: Key | null) => onChange(key === null ? "" : String(key))}
      isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
      isRequired={props.isRequired}
      fullWidth
    >
      <Select.Trigger>
        <Select.Value>{getOptionLabel(options, value) || placeholder}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function RuntimeMultiSelect({
  field,
  onChange,
  options,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  onChange: (value: string[]) => void;
  options: RuntimeFieldOption[];
  placeholder: string;
  props: RuntimeFieldProps;
  value: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabels = value.map((item) => getOptionLabel(options, item)).filter(Boolean);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
        onClick={() => setIsOpen((current) => !current)}
        className="min-h-10 w-full justify-start rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)]"
      >
        {selectedLabels.length > 0 ? selectedLabels.join("、") : placeholder}
      </Button>
      {isOpen ? (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-[var(--shadow-floating)]">
          <CheckboxGroup
            aria-label={field.label}
            value={value}
            onChange={onChange}
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            isRequired={props.isRequired}
          >
            {options.map((option) => (
              <Checkbox key={option.value} value={option.value}>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>{option.label}</Checkbox.Content>
              </Checkbox>
            ))}
          </CheckboxGroup>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeUpload({
  field,
  props,
}: {
  field: RuntimeSchemaField;
  props: RuntimeFieldProps;
}) {
  return (
    <label className="block rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
      <span
        className={[
          "inline-flex h-8 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]",
          props.isDisabled || props.isReadOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        ].join(" ")}
      >
        {props.buttonText || props.placeholder || "上传"}
      </span>
      <input
        className="sr-only"
        type="file"
        name={field.id}
        accept={props.accept}
        multiple={props.multiple}
        disabled={props.isDisabled || props.isReadOnly}
        required={props.isRequired}
      />
    </label>
  );
}

function RuntimeDateRangePicker({
  field,
  props,
  value,
  onChange,
}: {
  field: RuntimeSchemaField;
  props: RuntimeFieldProps;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const defaultValue = getDateRangeValue(value);

  return (
    <DateRangePicker
      aria-label={field.label}
      className="low-code-date-range-picker"
      defaultValue={defaultValue as never}
      isDisabled={props.isDisabled}
      isReadOnly={props.isReadOnly}
      onChange={(nextValue: { start: { toString: () => string }; end: { toString: () => string } } | null) =>
        onChange(nextValue ? [nextValue.start.toString(), nextValue.end.toString()] : [])
      }
    >
      <DateInputGroup fullWidth>
        <DateInputGroup.InputContainer>
          <DateInputGroup.Input slot="start">
            {(segment) => <DateInputGroup.Segment segment={segment} />}
          </DateInputGroup.Input>
          <DateRangePicker.RangeSeparator>-</DateRangePicker.RangeSeparator>
          <DateInputGroup.Input slot="end">
            {(segment) => <DateInputGroup.Segment segment={segment} />}
          </DateInputGroup.Input>
        </DateInputGroup.InputContainer>
        <DateInputGroup.Suffix>
          <DateRangePicker.Trigger>
            <DateRangePicker.TriggerIndicator />
          </DateRangePicker.Trigger>
        </DateInputGroup.Suffix>
      </DateInputGroup>
      <DateRangePicker.Popover>
        <RangeCalendar>
          <RangeCalendar.Header>
            <RangeCalendar.NavButton slot="previous" />
            <RangeCalendar.Heading />
            <RangeCalendar.NavButton slot="next" />
          </RangeCalendar.Header>
          <RangeCalendar.Grid>
            <RangeCalendar.GridHeader>
              {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
            </RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>
              {(date) => <RangeCalendar.Cell date={date} />}
            </RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar>
      </DateRangePicker.Popover>
    </DateRangePicker>
  );
}

function RuntimeClearButton({
  isDisabled,
  onClear,
}: {
  isDisabled: boolean;
  onClear: () => void;
}) {
  return (
    <Button
      type="button"
      isIconOnly
      aria-label="清除"
      isDisabled={isDisabled}
      onClick={onClear}
      className="absolute right-2 top-2 h-5 w-5 rounded-full bg-[var(--color-bg-subtle)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-soft)]"
    >
      ×
    </Button>
  );
}

function Counter({ value }: { value: string }) {
  return (
    <div className="pointer-events-none absolute -bottom-5 right-0 text-xs text-[var(--color-text-disabled)]">
      {value.length}/500
    </div>
  );
}

function getInitialValues(
  fields: RuntimeSchemaField[],
  initialValues?: Record<string, unknown>,
) {
  const values: Record<string, unknown> = {};
  const subformIds = new Set(fields.filter((field) => field.type === "subform").map((field) => field.id));

  for (const field of fields) {
    if (field.parentGroupId && subformIds.has(field.parentGroupId)) {
      continue;
    }
    if (field.type === "description" || field.type === "link" || field.type === "groupContainer") {
      continue;
    }

    if (field.type === "subform") {
      values[field.id] = Array.isArray(initialValues?.[field.id]) ? initialValues?.[field.id] : [];
      continue;
    }

    if (field.type === "button") {
      values[field.id] = initialValues?.[field.id] ?? field.props?.defaultValue ?? "";
      continue;
    }

    values[field.id] = initialValues?.[field.id] ?? getFieldDefaultValue(field);
  }

  return values;
}

function getInitialDataSources(dataSources?: RuntimeDataSource[]) {
  const result: Record<string, unknown> = {};

  for (const source of dataSources ?? []) {
    result[source.name] = parseDataSourceValue(source);
  }

  return result;
}

function parseDataSourceValue(source: RuntimeDataSource) {
  if (source.kind === "number") {
    const next = Number(source.initialValue);
    return Number.isFinite(next) ? next : 0;
  }

  if (source.kind === "boolean") {
    return source.initialValue === "true";
  }

  if (source.kind === "object") {
    try {
      return source.initialValue ? JSON.parse(source.initialValue) : {};
    } catch {
      return {};
    }
  }

  return source.initialValue;
}

function getFieldDefaultValue(field: RuntimeSchemaField) {
  const defaultValue = field.props?.defaultValue;

  if (field.type === "checkbox" || field.type === "multiSelect" || field.type === "dateRange") {
    return Array.isArray(defaultValue) ? defaultValue : [];
  }

  if (field.type === "number") {
    return toOptionalNumber(defaultValue) ?? "";
  }

  return defaultValue ?? "";
}

function runActionHandler({
  actionModule,
  handlerName,
  fieldId,
  eventName,
  dataSources,
  onError,
  onErrorEvent,
  onSuccess,
  urlParams,
  value,
  values,
}: {
  actionModule: RuntimeActionModule;
  handlerName: keyof RuntimeActionModuleHandlers;
  fieldId: string;
  eventName: string;
  dataSources: Record<string, unknown>;
  onError?: (message: string) => void;
  onErrorEvent?: (message: string) => void;
  onSuccess?: (result: unknown) => void;
  urlParams: Record<string, string>;
  value: unknown;
  values: Record<string, unknown>;
}) {
  if (actionModule.error) {
    onError?.(actionModule.error);
    onErrorEvent?.(actionModule.error);
    return undefined;
  }

  const handler = actionModule.handlers[handlerName];

  if (!handler) {
    return undefined;
  }

  const state: RuntimeActionState = {
    values,
    urlParams,
    dataSources,
  };

  const helpers: RuntimeActionHelpers = {
    state,
    getFieldValue: (id: string) => values[id],
    setFieldValue: (id: string, nextValue: unknown) => {
      values[id] = nextValue;
    },
    getDataSource: (name: string) => dataSources[name],
    setDataSource: (name: string, nextValue: unknown) => {
      dataSources[name] = nextValue;
    },
    eventName,
    fieldId,
    value,
    console,
  };

  try {
    const context: RuntimeActionContext = {
      state,
      values,
      urlParams,
      dataSources,
      fieldId,
      eventName,
      value,
      helpers,
      console,
    };

    const result = handler.call({ state }, context);
    onSuccess?.(result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知脚本错误";
    onError?.(message);
    onErrorEvent?.(message);
    console.error("[runtime-action-error]", error);
    return undefined;
  }
}

type RuntimeActionState = {
  values: Record<string, unknown>;
  urlParams: Record<string, string>;
  dataSources: Record<string, unknown>;
};

type RuntimeActionHelpers = {
  state: RuntimeActionState;
  getFieldValue: (id: string) => unknown;
  setFieldValue: (id: string, nextValue: unknown) => void;
  getDataSource: (name: string) => unknown;
  setDataSource: (name: string, nextValue: unknown) => void;
  eventName: string;
  fieldId: string;
  value: unknown;
  console: Console;
};

type RuntimeActionContext = {
  state: RuntimeActionState;
  values: Record<string, unknown>;
  urlParams: Record<string, string>;
  dataSources: Record<string, unknown>;
  fieldId: string;
  eventName: string;
  value: unknown;
  helpers: RuntimeActionHelpers;
  console: Console;
};

type RuntimeActionHandler = (context: RuntimeActionContext) => unknown;

type RuntimeActionModuleHandlers = {
  didMount?: RuntimeActionHandler;
  onSubmit?: RuntimeActionHandler;
  onFieldEvent?: RuntimeActionHandler;
};

type RuntimeActionModule = {
  handlers: RuntimeActionModuleHandlers;
  error?: string;
};

function buildInitialRuntimeState(
  fields: RuntimeSchemaField[],
  dataSourceDefinitions: RuntimeDataSource[] | undefined,
  initialValues?: Record<string, unknown>,
): RuntimeRendererState {
  const initialFieldValues = getInitialValues(fields, initialValues);
  const calculated = calculateFormulaValues(fields, initialFieldValues);
  const values = calculated.values;
  const dataSources = getInitialDataSources(dataSourceDefinitions);
  return { values, dataSources, formulaErrors: calculated.errors, debugEvent: undefined };
}

function compileActionModule(code: string): RuntimeActionModule {
  if (!code.trim()) {
    return { handlers: {} };
  }

  try {
    const factory = new Function(
      `"use strict"; ${code}
return {
  didMount: typeof didMount === "function" ? didMount : undefined,
  onSubmit: typeof onSubmit === "function" ? onSubmit : undefined,
  onFieldEvent: typeof onFieldEvent === "function" ? onFieldEvent : undefined,
};`,
    ) as () => RuntimeActionModuleHandlers;

    return { handlers: factory() };
  } catch (error) {
    return {
      handlers: {},
      error: error instanceof Error ? error.message : "动作脚本编译失败",
    };
  }
}

function createRuntimeDebugEventId() {
  runtimeDebugEventSequence += 1;
  return `debug-${Date.now()}-${runtimeDebugEventSequence}`;
}

function shouldDeduplicateDidMountExecution(executionKey: string) {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const now = Date.now();
  const lastRunAt = recentDidMountExecutions.get(executionKey);

  recentDidMountExecutions.set(executionKey, now);

  for (const [key, value] of recentDidMountExecutions.entries()) {
    if (now - value > DID_MOUNT_DEDUP_WINDOW_MS) {
      recentDidMountExecutions.delete(key);
    }
  }

  return typeof lastRunAt === "number" && now - lastRunAt < DID_MOUNT_DEDUP_WINDOW_MS;
}

function stringifyDebugValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeFieldOptions(options?: RuntimeFieldOption[], type?: RuntimeFieldType) {
  if (options && options.length > 0) {
    return options;
  }

  if (type === "member") {
    return DEFAULT_MEMBER_OPTIONS;
  }

  if (type === "department") {
    return DEFAULT_DEPARTMENT_OPTIONS;
  }

  return DEFAULT_OPTIONS;
}

function getOptionLabel(options: RuntimeFieldOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function getDateRangeValue(value: string[]) {
  const [startValue, endValue] = value;

  if (!startValue || !endValue) {
    return undefined;
  }

  try {
    return {
      start: parseDate(startValue),
      end: parseDate(endValue),
    };
  } catch {
    return undefined;
  }
}

function toOptionalNumber(value: string | number | string[] | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  return undefined;
}

function isTopAlignedRuntimeField(type: RuntimeFieldType) {
  return (
    type === "groupContainer" ||
    type === "description" ||
    type === "multiLineText" ||
    type === "radio" ||
    type === "checkbox" ||
    type === "attachment" ||
    type === "imageUpload"
    || type === "subform"
  );
}
