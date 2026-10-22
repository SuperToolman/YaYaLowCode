"use client";
import { notifyRequestError } from "@lib/notify";
import { getFieldDescription } from "./field-description";
import { normalizeValidationProps } from "../validation-config";
import { validateFormSubmission } from "../api";
import { notify } from "@lib/notify";

import dynamic from "next/dynamic";
import {
  memo,
  createContext,
  useContext,
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
  Button,
  ErrorMessage,
  FieldError,
  Label,
  Input,
  InputGroup,
  Link,
  NumberField,
  Radio,
  RadioGroup,
  TextField,
  ButtonGroup,
} from "@heroui/react";
import { Description } from "@heroui/react/description";
import { TextContext } from "react-aria-components";
import { normalizeActionPanelCode } from "@lib/action-panel-code";
import { calculateFormulaValues } from "@lib/form-formula";
import {
  compileRuntimeActionModule,
  createRuntimeDebugEventId,
  runRuntimeActionHandler,
  shouldDeduplicateDidMountExecution,
  stringifyRuntimeDebugValue,
} from "./runtime-form-action-engine";
import { normalizeCountryCityValue } from "@lib/location-catalog";
import { TrashBin } from "@gravity-ui/icons";
import { RuntimeAssociationField } from "./RuntimeAssociationField";
import { RuntimeMemberSelect } from "./RuntimeMemberSelect";
import { RuntimeCascaderSelect } from "./RuntimeCascaderSelect";
import { RuntimeSubformTable } from "./RuntimeSubformTable";
import type { RichTextDocument } from "@shared/ui/RichTextEditor";
import { RuntimeDefinedComponent } from "./RuntimeDefinedComponent";
import {
  Counter,
  RuntimeCheckboxOptions,
  RuntimeClearButton,
  RuntimeCountryCitySelect,
  RuntimeDateRangePicker,
  RuntimeDatePicker,
  RuntimeMultiSelect,
  RuntimeSelect,
  RuntimeUpload,
} from "./RuntimeFormFieldControls";

const RichTextEditor = dynamic(
  () =>
    import("@shared/ui/RichTextEditor").then((module) => module.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="富文本加载中"
        className="flex min-h-32 w-full animate-pulse flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      >
        <div className="h-9 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]" />
        <div className="m-3 h-4 w-2/5 rounded bg-[var(--color-bg-subtle)]" />
      </div>
    ),
  },
);
import type {
  RuntimeDataSource,
  RuntimeDebugEvent,
  RuntimeFieldOption,
  RuntimeFieldProps,
  RuntimeFieldType,
  RuntimeFormRendererProps,
  RuntimePageAsset,
  RuntimeSchemaField,
} from "./runtime-form-types";
import { FormGroup } from "./FormGroup";
import {
  getSubformValidationKey,
  validateRuntimeFields,
} from "./runtime-form-validation";

const ValidationErrorsContext = createContext<Record<string, string>>({});
export type {
  RuntimeActionPanelState,
  RuntimeDataSource,
  RuntimeDebugEvent,
  RuntimeFieldAction,
  RuntimeFieldOption,
  RuntimeFieldProps,
  RuntimeFieldType,
  RuntimeFormSchema,
  RuntimePageAsset,
  RuntimePageProps,
  RuntimeSchemaField,
} from "./runtime-form-types";

const DEFAULT_COLUMN_GAP = 16;
const DEFAULT_ROW_GAP = 20;
const DEFAULT_OPTIONS: RuntimeFieldOption[] = [
  { label: "选项一", value: "选项一" },
  { label: "选项二", value: "选项二" },
];
const DEFAULT_DEPARTMENT_OPTIONS: RuntimeFieldOption[] = [
  { label: "产品部", value: "product" },
  { label: "研发部", value: "engineering" },
  { label: "运营部", value: "operations" },
];
type RuntimeRendererState = {
  values: Record<string, unknown>;
  dataSources: Record<string, unknown>;
  formulaErrors: Record<string, string>;
  debugEvent?: RuntimeDebugEvent;
};

export function RuntimeFormSurface({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function RuntimeFormRenderer({
  schema,
  submitLabel,
  formId,
  recordUuid,
  submitting = false,
  showSubmitButton = true,
  isReadOnly = false,
  initialValues,
  urlParams = {},
  onDebugEvent,
  onValuesChange,
  valuePatch,
  onSubmit,
}: RuntimeFormRendererProps) {
  const submittingValidationRef = useRef(false);
  const didMountExecutedRef = useRef(false);
  const emittedDebugEventIdRef = useRef<string | null>(null);
  const fields = useMemo(
    () =>
      schema.fields.map((field) => ({
        ...field,
        parentGroupId: field.parentGroupId ?? null,
        props: normalizeValidationProps({
          ...field.props,
          ...(isReadOnly ? { isReadOnly: true } : {}),
          ...(field.type === "serialNumber" ? { isRequired: true } : {}),
        }),
      })),
    [isReadOnly, schema.fields],
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
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [remoteValidation, setRemoteValidation] = useState<{
    values: Record<string, unknown>;
    errors: Record<string, string>;
  } | null>(null);
  const [validatingSubmission, setValidatingSubmission] = useState(false);
  const validationErrors = useMemo(
    () =>
      hasSubmitted
        ? {
            ...validateRuntimeFields(fields, values),
            ...(remoteValidation?.values === values
              ? remoteValidation.errors
              : {}),
          }
        : {},
    [fields, hasSubmitted, values, remoteValidation],
  );

  useEffect(() => {
    onValuesChange?.(runtimeState.values);
  }, [onValuesChange, runtimeState.values]);

  useEffect(() => {
    if (!valuePatch) return;
    const timer = window.setTimeout(() => {
      setRuntimeState((current) => {
        const nextValues = { ...current.values, ...valuePatch.values };
        const calculated = calculateFormulaValues(fields, nextValues);
        return {
          ...current,
          values: calculated.values,
          formulaErrors: calculated.errors,
        };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fields, valuePatch]);
  const dataSources = runtimeState.dataSources;
  const actionModule = useMemo(
    () => compileRuntimeActionModule(normalizedActionCode),
    [normalizedActionCode],
  );
  const runtimeContextRef = useRef({
    actionModule,
    dataSources,
    fields,
    onDebugEvent,
    urlParams,
    values,
  });
  useLayoutEffect(() => {
    runtimeContextRef.current = {
      actionModule,
      dataSources,
      fields,
      onDebugEvent,
      urlParams,
      values,
    };
  }, [actionModule, dataSources, fields, onDebugEvent, urlParams, values]);
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
    if (isReadOnly) {
      return;
    }

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
        notify.error("页面加载动作执行失败", {
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
        const result = runRuntimeActionHandler({
          actionModule,
          fields,
          handlerName: "didMount",
          fieldId: "",
          eventName: "didMount",
          dataSources: nextDataSources,
          onError: (message) =>
            notify.error("页面加载动作执行失败", {
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
            result: didMountErrorMessage
              ? undefined
              : stringifyRuntimeDebugValue(result ?? nextValues),
            createdAt: new Date().toISOString(),
          },
        };
      });
    }, 0);
  }, [actionModule, didMountExecutionKey, fields, isReadOnly, urlParams]);

  const visibleRootFields = useMemo(
    () =>
      fields
        .filter((field) => !field.props?.isHidden && !field.parentGroupId)
        .sort(
          (left, right) => left.row - right.row || left.column - right.column,
        ),
    [fields],
  );
  const descriptionRows = useMemo(
    () =>
      new Set(
        visibleRootFields
          .filter((field) => getFieldDescription(field.type, field.props ?? {}))
          .map((field) => field.row),
      ),
    [visibleRootFields],
  );
  const childFieldsByParent = useMemo(() => {
    const childrenByParent = new Map<string, RuntimeSchemaField[]>();
    const fieldsById = new Map(fields.map((field) => [field.id, field]));

    for (const field of fields) {
      if (!field.parentGroupId || field.props?.isHidden) continue;
      const children = childrenByParent.get(field.parentGroupId) ?? [];
      children.push(field);
      childrenByParent.set(field.parentGroupId, children);
    }

    for (const [parentId, children] of childrenByParent) {
      const parent = fieldsById.get(parentId);
      children.sort((left, right) =>
        parent?.type === "subform"
          ? left.column - right.column
          : left.row - right.row || left.column - right.column,
      );
    }

    return childrenByParent;
  }, [fields]);
  const definedComponentWritableFieldIds = useMemo(
    () =>
      fields
        .filter(
          (field) =>
            ![
              "html",
              "tsx",
              "description",
              "button",
              "groupContainer",
            ].includes(field.type),
        )
        .map((field) => field.id),
    [fields],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingValidationRef.current || submitting) return;
    const submitValues = calculateFormulaValues(fields, values).values;
    setHasSubmitted(true);
    if (Object.keys(validateRuntimeFields(fields, submitValues)).length > 0)
      return;
    const submitDataSources = { ...dataSources };
    const result = runRuntimeActionHandler({
      actionModule,
      fields,
      handlerName: "onSubmit",
      fieldId: "",
      eventName: "onSubmit",
      dataSources: submitDataSources,
      onError: (message) =>
        notify.error("表单动作执行失败", {
          description: message,
        }),
      onSuccess: (output) =>
        onDebugEvent?.({
          id: createRuntimeDebugEventId(),
          type: "submit",
          eventName: "onSubmit",
          status: "success",
          message: "提交动作执行成功",
          result: stringifyRuntimeDebugValue(output ?? submitValues),
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

    const configuredFields = fields.filter(
      (field) => field.props?.isUnique || field.props?.formatValidation,
    );
    if (configuredFields.length) {
      submittingValidationRef.current = true;
      setValidatingSubmission(true);
      try {
        const errors = await validateFormSubmission(
          schema,
          payload,
          recordUuid,
        );
        // Ignore responses if inputs changed while validation was in flight.
        if (runtimeContextRef.current.values !== calculatedSubmit.values)
          return;
        if (Object.keys(errors).length) {
          setRuntimeState((current) => ({ ...current, values: payload }));
          setRemoteValidation({ values: payload, errors });
          return;
        }
        await onSubmit(payload);
      } catch (error) {
        notifyRequestError(error, "提交校验失败", {
          description:
            error instanceof Error ? error.message : "无法完成提交校验",
        });
      } finally {
        submittingValidationRef.current = false;
        setValidatingSubmission(false);
      }
      return;
    }
    await onSubmit(payload);
  }

  const setFieldValue = useCallback(
    (fieldId: string, nextValue: unknown, eventName = "onChange") => {
      const current = runtimeContextRef.current;
      const nextValues = { ...current.values, [fieldId]: nextValue };
      const nextDataSources = { ...current.dataSources };
      runRuntimeActionHandler({
        actionModule: current.actionModule,
        fields: current.fields,
        handlerName: "onFieldEvent",
        fieldId,
        eventName,
        dataSources: nextDataSources,
        onError: (message) =>
          notify.error("组件事件执行失败", {
            description: `${fieldId} / ${eventName}: ${message}`,
          }),
        onSuccess: (output) =>
          current.onDebugEvent?.({
            id: createRuntimeDebugEventId(),
            type: "field",
            fieldId,
            eventName,
            status: "success",
            message: "组件事件执行成功",
            result: stringifyRuntimeDebugValue(output ?? nextValues[fieldId]),
            createdAt: new Date().toISOString(),
          }),
        onErrorEvent: (message) =>
          current.onDebugEvent?.({
            id: createRuntimeDebugEventId(),
            type: "field",
            fieldId,
            eventName,
            status: "error",
            message,
            createdAt: new Date().toISOString(),
          }),
        urlParams: current.urlParams,
        value: nextValue,
        values: nextValues,
      });

      const calculated = calculateFormulaValues(current.fields, nextValues, {
        changedFieldIds: [fieldId],
      });
      runtimeContextRef.current = {
        ...current,
        values: calculated.values,
        dataSources: nextDataSources,
      };
      setRuntimeState({
        values: calculated.values,
        dataSources: nextDataSources,
        formulaErrors: calculated.errors,
        debugEvent: undefined,
      });
    },
    [],
  );

  return (
    <ValidationErrorsContext.Provider value={validationErrors}>
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className={isReadOnly ? "runtime-form-readonly" : undefined}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${schema.columns}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(68px, auto)",
            columnGap: DEFAULT_COLUMN_GAP,
            rowGap: DEFAULT_ROW_GAP,
          }}
        >
          {visibleRootFields.map((field) => (
            <div
              key={field.id}
              className={[
                "flex min-w-0",
                (field.rowSpan ?? 1) > 1 ||
                field.type === "multiLineText" ||
                field.type === "richText" ||
                field.type === "html" ||
                field.type === "tsx"
                  ? "items-stretch"
                  : isTopAlignedRuntimeField(field.type) ||
                      descriptionRows.has(field.row)
                    ? "items-start"
                    : "items-end",
              ].join(" ")}
              style={{
                gridColumn: `${field.column + 1} / span ${field.colSpan ?? 1}`,
                gridRow: `${field.row + 1} / span ${field.rowSpan ?? 1}`,
              }}
            >
              <RuntimeFieldNode
                childFieldsByParent={childFieldsByParent}
                field={field}
                formulaErrors={runtimeState.formulaErrors}
                value={values[field.id]}
                values={values}
                definedComponentWritableFieldIds={
                  definedComponentWritableFieldIds
                }
                definedAssets={schema.pageProps?.assets ?? []}
                onFieldAction={setFieldValue}
              />
            </div>
          ))}
        </div>

        {showSubmitButton ? (
          <div className="mt-8 flex justify-end">
            <Button
              type="submit"
              isDisabled={submitting || validatingSubmission}
              className="bg-[var(--color-primary)] text-[var(--color-text-on-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]"
            >
              {validatingSubmission
                ? "校验中..."
                : submitting
                  ? "提交中..."
                  : submitLabel}
            </Button>
          </div>
        ) : null}
      </form>
    </ValidationErrorsContext.Provider>
  );
}

export type FormFieldRenderMode = "runtime" | "designer";

export type SharedFormFieldProps = {
  childFieldsByParent: Map<string, RuntimeSchemaField[]>;
  definedComponentWritableFieldIds?: string[];
  definedAssets?: RuntimePageAsset[];
  field: RuntimeSchemaField;
  formulaErrors?: Record<string, string>;
  mode?: FormFieldRenderMode;
  onFieldAction?: (
    fieldId: string,
    nextValue: unknown,
    eventName?: string,
  ) => void;
  value: unknown;
  values: Record<string, unknown>;
};

export function RuntimeFieldNode({
  childFieldsByParent,
  definedComponentWritableFieldIds,
  definedAssets,
  field,
  formulaErrors,
  mode = "runtime",
  onFieldAction,
  value,
  values,
}: SharedFormFieldProps) {
  const validationErrors = useContext(ValidationErrorsContext);
  const readOnlyField =
    mode === "designer"
      ? {
          ...field,
          props: {
            ...field.props,
            isDisabled: true,
            isReadOnly: true,
          },
        }
      : field;
  const emitFieldAction =
    mode === "designer"
      ? () => undefined
      : (onFieldAction ?? (() => undefined));

  if (readOnlyField.type === "subform") {
    const childFields = childFieldsByParent.get(field.id) ?? [];
    return (
      <RuntimeSubform
        field={readOnlyField}
        childFields={childFields}
        mode={mode}
        value={value}
        onChange={(nextValue) =>
          emitFieldAction(field.id, nextValue, "onChange")
        }
        isGrouped={Boolean(field.parentGroupId)}
      />
    );
  }

  if (readOnlyField.type === "groupContainer") {
    const childFields = childFieldsByParent.get(field.id) ?? [];

    return (
      <FormGroup
        title={field.label}
        description={field.props?.description}
        groupStyle={field.props?.groupStyle}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${field.colSpan ?? 1}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(68px, auto)",
            columnGap: DEFAULT_COLUMN_GAP,
            rowGap: DEFAULT_ROW_GAP,
          }}
        >
          {childFields.map((child) => (
            <div
              key={child.id}
              className={[
                "flex min-w-0",
                (child.rowSpan ?? 1) > 1 ||
                child.type === "multiLineText" ||
                child.type === "richText" ||
                child.type === "html" ||
                child.type === "tsx"
                  ? "items-stretch"
                  : isTopAlignedRuntimeField(child.type)
                    ? "items-start"
                    : "items-end",
              ].join(" ")}
              style={{
                gridColumn: `${child.column - field.column + 1} / span ${child.colSpan ?? 1}`,
                gridRow: `${child.row - field.row + 1} / span ${child.rowSpan ?? 1}`,
              }}
            >
              <RuntimeFieldNode
                childFieldsByParent={childFieldsByParent}
                definedComponentWritableFieldIds={
                  definedComponentWritableFieldIds
                }
                definedAssets={definedAssets}
                field={child}
                formulaErrors={formulaErrors}
                mode={mode}
                onFieldAction={emitFieldAction}
                value={values[child.id]}
                values={values}
              />
            </div>
          ))}
        </div>
      </FormGroup>
    );
  }

  if (readOnlyField.type === "associationFormField") {
    return (
      <RuntimeAssociationField
        field={readOnlyField}
        errorMessage={validationErrors[field.id]}
        value={value}
        onChange={(nextValue) =>
          emitFieldAction(field.id, nextValue, "onChange")
        }
        onFill={(source) =>
          applyAssociationFillRules(
            readOnlyField.props,
            source,
            emitFieldAction,
          )
        }
      />
    );
  }

  if (readOnlyField.type === "html" || readOnlyField.type === "tsx") {
    return (
      <RuntimeDefinedComponent
        type={readOnlyField.type}
        code={readOnlyField.props?.code}
        allowedResourceOrigins={readOnlyField.props?.allowedResourceOrigins}
        allowedFieldIds={definedComponentWritableFieldIds ?? []}
        assets={definedAssets ?? []}
        values={values}
        isReadOnly
        onSetFieldValue={(fieldId, nextValue) =>
          emitFieldAction(fieldId, nextValue, "onChange")
        }
      />
    );
  }

  return (
    <FormField
      field={readOnlyField}
      formulaError={formulaErrors?.[field.id]}
      onFieldAction={emitFieldAction}
      value={value}
    />
  );
}

function applyAssociationFillRules(
  props: RuntimeFieldProps | undefined,
  source: Record<string, unknown>,
  onFieldAction: (
    fieldId: string,
    nextValue: unknown,
    eventName?: string,
  ) => void,
) {
  for (const fill of props?.associationFills ?? []) {
    onFieldAction(
      fill.targetFieldId,
      source[fill.sourceFieldId] ?? "",
      "onChange",
    );
  }

  for (const subformFill of props?.associationSubformFills ?? []) {
    const sourceSubformValue = source[subformFill.sourceSubformId];
    const sourceRows = Array.isArray(sourceSubformValue)
      ? sourceSubformValue.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object" && !Array.isArray(row),
        )
      : [];
    const targetRows = sourceRows.map((row) =>
      Object.fromEntries(
        subformFill.mappings.map((mapping) => [
          mapping.targetFieldId,
          row[mapping.sourceFieldId] ?? "",
        ]),
      ),
    );
    onFieldAction(subformFill.targetSubformId, targetRows, "onChange");
  }
}

function RuntimeSubform({
  field,
  childFields,
  mode = "runtime",
  value,
  onChange,
  isGrouped = false,
}: {
  field: RuntimeSchemaField;
  childFields: RuntimeSchemaField[];
  mode?: FormFieldRenderMode;
  value: unknown;
  onChange: (value: Array<Record<string, unknown>>) => void;
  isGrouped?: boolean;
}) {
  const validationErrors = useContext(ValidationErrorsContext);
  const props = field.props ?? {};
  const description =
    props.description?.trim() === "可拖入普通字段作为表格列。"
      ? ""
      : props.description?.trim();
  const rows = Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const maxRows = props.subformMaxRows ?? 500;
  const isReadOnly = Boolean(props.isDisabled || props.isReadOnly);
  const showActions = !isReadOnly;

  function updateCell(rowIndex: number, fieldId: string, nextValue: unknown) {
    onChange(
      rows.map((row, index) =>
        index === rowIndex ? { ...row, [fieldId]: nextValue } : row,
      ),
    );
  }

  function addRow() {
    if (
      isReadOnly ||
      rows.length >= maxRows ||
      props.subformButtonState !== "normal"
    )
      return;
    onChange([
      ...rows,
      Object.fromEntries(
        childFields.map((child) => [child.id, getFieldDefaultValue(child)]),
      ),
    ]);
  }

  function removeRow(rowIndex: number) {
    if (isReadOnly) return;
    onChange(rows.filter((_, index) => index !== rowIndex));
  }

  function copyRow(rowIndex: number) {
    if (isReadOnly || rows.length >= maxRows) return;
    onChange([
      ...rows.slice(0, rowIndex + 1),
      { ...rows[rowIndex] },
      ...rows.slice(rowIndex + 1),
    ]);
  }

  function moveRow(rowIndex: number, direction: -1 | 1) {
    if (isReadOnly) return;
    const targetIndex = rowIndex + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const nextRows = [...rows];
    [nextRows[rowIndex], nextRows[targetIndex]] = [
      nextRows[targetIndex],
      nextRows[rowIndex],
    ];
    onChange(nextRows);
  }

  return (
    <section
      className={
        isGrouped
          ? "w-full min-w-0 space-y-3 rounded-lg bg-[var(--color-bg-surface)] p-3"
          : "w-full min-w-0 space-y-3"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{field.label}</div>
          {description ? (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
        <ButtonGroup>
          {props.subformAllowBatchImport ? (
            <Button size="sm" variant="secondary" isDisabled>
              批量导入
            </Button>
          ) : null}
          {props.subformAllowExcelExport ? (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={rows.length === 0}
            >
              导出 Excel
            </Button>
          ) : null}
          {!isReadOnly && props.subformButtonState !== "hidden" ? (
            <Button
              size="sm"
              isDisabled={
                props.subformButtonState === "disabled" ||
                rows.length >= maxRows
              }
              onPress={addRow}
            >
              {props.subformAddButtonText ?? "新增一项"}
            </Button>
          ) : null}
        </ButtonGroup>
      </div>
      <RuntimeSubformTable
        childFields={childFields}
        props={props}
        rows={rows}
        showActions={showActions}
        renderCell={(child, row, rowIndex) => {
          const renderChild =
            mode === "designer"
              ? {
                  ...child,
                  props: {
                    ...child.props,
                    isDisabled: true,
                    isReadOnly: true,
                  },
                }
              : child;
          return renderChild.type === "associationFormField" ? (
            <RuntimeAssociationField
              field={renderChild}
              errorMessage={
                validationErrors[
                  getSubformValidationKey(field.id, rowIndex, child.id)
                ]
              }
              value={row[renderChild.id]}
              showLabel={false}
              onChange={(nextValue) =>
                updateCell(rowIndex, renderChild.id, nextValue)
              }
              onFill={() => undefined}
            />
          ) : (
            <FormField
              field={renderChild}
              validationKey={getSubformValidationKey(
                field.id,
                rowIndex,
                child.id,
              )}
              value={row[renderChild.id]}
              showLabel={false}
              onFieldAction={(_, nextValue) =>
                updateCell(rowIndex, renderChild.id, nextValue)
              }
            />
          );
        }}
        renderActions={(rowIndex) => (
          <div className="flex items-center justify-center gap-1">
            {props.subformShowSort ? (
              <>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label="上移"
                  onPress={() => moveRow(rowIndex, -1)}
                >
                  ↑
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label="下移"
                  onPress={() => moveRow(rowIndex, 1)}
                >
                  ↓
                </Button>
              </>
            ) : null}
            {props.subformShowCopyButton ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => copyRow(rowIndex)}
              >
                复制
              </Button>
            ) : null}
            {props.subformShowDeleteButton !== false ? (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="text-[var(--color-danger)]"
                aria-label={props.subformDeleteButtonText ?? "删除"}
                onPress={() => removeRow(rowIndex)}
              >
                <TrashBin />
              </Button>
            ) : null}
          </div>
        )}
      />
      {validationErrors[field.id] ? (
        <TextContext.Provider value={null}>
          <ErrorMessage style={{ display: "block" }}>
            {validationErrors[field.id]}
          </ErrorMessage>
        </TextContext.Provider>
      ) : null}
    </section>
  );
}

const FormField = memo(function FormField({
  field,
  formulaError,
  onFieldAction,
  showLabel = true,
  validationKey,
  value,
}: {
  field: RuntimeSchemaField;
  formulaError?: string;
  onFieldAction: (
    fieldId: string,
    nextValue: unknown,
    eventName?: string,
  ) => void;
  showLabel?: boolean;
  validationKey?: string;
  value: unknown;
}) {
  const validationErrors = useContext(ValidationErrorsContext);
  const error = validationErrors[validationKey ?? field.id];
  const errorId = useId();
  const usesFieldError = [
    "singleLineText",
    "multiLineText",
    "date",
    "number",
    "radio",
    "select",
    "multiSelect",
    "department",
    "member",
    "dateRange",
  ].includes(field.type);
  const props = field.props ?? {};
  const titlePosition = getRuntimeTitlePosition(
    field.type,
    props.titlePosition,
  );
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
  const multiValues = Array.isArray(value)
    ? (value as string[])
    : Array.isArray(props.defaultValue)
      ? props.defaultValue
      : [];
  const numberValue =
    typeof value === "number"
      ? value
      : (toOptionalNumber(value as string | number | string[] | undefined) ??
        toOptionalNumber(
          props.defaultValue as string | number | string[] | undefined,
        ));
  const description = getFieldDescription(field.type, props);
  const orientation =
    field.type === "radio" || field.type === "checkbox"
      ? "horizontal"
      : (props.orientation ?? "vertical");

  const hasVisibleLabel =
    showLabel &&
    !["button", "description", "link"].includes(field.type) &&
    titlePosition !== "inside";
  const isLeftTitle = hasVisibleLabel && titlePosition === "left";
  const isInsideTitle = titlePosition === "inside";
  const fillsFieldHeight =
    field.type === "multiLineText" || field.type === "richText" ||
    field.type === "attachment" || field.type === "imageUpload";
  const contentClass =
    fillsFieldHeight
      ? "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2"
      : "w-full min-w-0 space-y-2";

  return (
    <div
      className={
        isLeftTitle
          ? "grid h-full w-full min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-start gap-3 pt-7"
          : fillsFieldHeight
            ? "flex h-full min-h-0 w-full min-w-0 flex-col"
            : "w-full min-w-0"
      }
    >
      {hasVisibleLabel ? (
        <Label
          isRequired={
            Boolean(props.isRequired) &&
            !["description", "link", "button", "html", "tsx"].includes(
              field.type,
            )
          }
          className={isLeftTitle ? "max-w-28 truncate pt-2" : "mb-2"}
          htmlFor={field.id}
        >
          {field.label}
        </Label>
      ) : null}
      <div
        className={contentClass}
        role="group"
        aria-label={field.label}
        aria-describedby={error && !usesFieldError ? errorId : undefined}
      >
        {field.type === "singleLineText" ? (
          <TextField
            aria-label={field.label}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            isRequired={props.isRequired}
            fullWidth
          >
            <div className="relative">
              {isInsideTitle ? (
                <InputGroup fullWidth>
                  <InputGroup.Prefix className="max-w-28 shrink-0">
                    <Label
                      htmlFor={field.id}
                      isRequired={props.isRequired}
                      className="truncate"
                    >
                      {field.label}
                    </Label>
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    id={field.id}
                    aria-label={field.label}
                    disabled={props.isDisabled}
                    placeholder={placeholder}
                    readOnly={props.isReadOnly}
                    required={props.isRequired}
                    value={textValue}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onFieldAction(
                        field.id,
                        event.currentTarget.value,
                        "onChange",
                      )
                    }
                    className="min-w-0 flex-1"
                  />
                </InputGroup>
              ) : (
                <Input
                  id={field.id}
                  aria-label={field.label}
                  disabled={props.isDisabled}
                  placeholder={placeholder}
                  readOnly={props.isReadOnly}
                  required={props.isRequired}
                  value={textValue}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onFieldAction(
                      field.id,
                      event.currentTarget.value,
                      "onChange",
                    )
                  }
                  fullWidth
                />
              )}
              {props.showClearButton ? (
                <RuntimeClearButton
                  isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
                  onClear={() => onFieldAction(field.id, "", "onChange")}
                />
              ) : null}
              {props.showCounter ? <Counter value={textValue} /> : null}
            </div>
            <FieldError>{error}</FieldError>
          </TextField>
        ) : null}
        {field.type === "description" ? (
          <Description>{textValue || placeholder}</Description>
        ) : null}
        {field.type === "serialNumber" ? (
          <Input
            id={field.id}
            aria-label={field.label}
            readOnly
            required={props.isRequired}
            placeholder={props.placeholder ?? "自动生成"}
            value={textValue || formatRuntimeSerialNumber(props)}
            fullWidth
          />
        ) : null}
        {field.type === "multiLineText" ? (
          <TextField
            aria-label={field.label}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            isRequired={props.isRequired}
            fullWidth
            className="min-h-0 flex-1"
          >
            <div className="relative min-h-0 flex-1">
              <InputGroup fullWidth className="h-full">
                <InputGroup.TextArea
                  id={field.id}
                  aria-label={field.label}
                  disabled={props.isDisabled}
                  placeholder={placeholder}
                  readOnly={props.isReadOnly}
                  required={props.isRequired}
                  rows={Math.max(2, field.rowSpan ?? 1)}
                  className="h-full min-h-0 w-full resize-none"
                  value={textValue}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    onFieldAction(
                      field.id,
                      event.currentTarget.value,
                      "onChange",
                    )
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
            <FieldError>{error}</FieldError>
          </TextField>
        ) : null}
        {field.type === "richText" ? (
          <RichTextEditor
            ariaLabel={field.label}
            disabled={props.isDisabled}
            readOnly={props.isReadOnly}
            value={isRichTextDocument(value) ? value : EMPTY_RICH_TEXT_DOCUMENT}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "number" ? (
          <NumberField
            aria-label={field.label}
            isRequired={props.isRequired}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            value={numberValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue ?? "", "onChange")
            }
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            maxValue={props.maxValue}
            minValue={props.minValue}
            fullWidth
          >
            <NumberField.Group>
              <NumberField.DecrementButton>-</NumberField.DecrementButton>
              <NumberField.Input id={field.id} placeholder={placeholder} />
              <NumberField.IncrementButton>+</NumberField.IncrementButton>
            </NumberField.Group>
            <FieldError>{error}</FieldError>
          </NumberField>
        ) : null}
        {field.type === "radio" ? (
          <RadioGroup
            aria-label={field.label}
            orientation={orientation}
            isInvalid={Boolean(error)}
            validationBehavior="aria"
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            isRequired={props.isRequired}
          >
            {options.map((option) => (
              <Radio key={option.value} value={option.value}>
                <Radio.Content className="text-[12px]">
                  <Radio.Control>
                    <Radio.Indicator />
                  </Radio.Control>
                  {option.label}
                </Radio.Content>
              </Radio>
            ))}
            <FieldError>{error}</FieldError>
          </RadioGroup>
        ) : null}
        {field.type === "checkbox" ? (
          <RuntimeCheckboxOptions
            ariaLabel={field.label}
            className={
              orientation === "horizontal"
                ? "flex flex-row flex-wrap items-center gap-x-3 gap-y-1.5"
                : "flex flex-col items-start gap-1.5"
            }
            value={multiValues}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
            options={options}
            isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
            isRequired={props.isRequired}
          />
        ) : null}
        {field.type === "select" || field.type === "department" ? (
          <RuntimeSelect
            field={field}
            errorMessage={error}
            options={options}
            placeholder={placeholder}
            props={props}
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "member" ? (
          <RuntimeMemberSelect
            field={field}
            errorMessage={error}
            placeholder={placeholder}
            props={props}
            value={props.memberMultiple ? multiValues : textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "countryCity" ? (
          <RuntimeCountryCitySelect
            field={field}
            props={props}
            value={value}
            onChange={(nextValue, eventName) =>
              onFieldAction(field.id, nextValue, eventName)
            }
          />
        ) : null}
        {field.type === "cascader" ? (
          <RuntimeCascaderSelect
            ariaLabel={field.label}
            dataSource={props.dataSource}
            isDisabled={props.isDisabled}
            isReadOnly={props.isReadOnly}
            placeholder={placeholder}
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "multiSelect" ? (
          <RuntimeMultiSelect
            field={field}
            errorMessage={error}
            options={options}
            placeholder={placeholder}
            props={props}
            value={multiValues}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "link" ? (
          <Link href={props.href || "#"} target={props.target}>
            {textValue || "打开链接"}
            <Link.Icon />
          </Link>
        ) : null}
        {field.type === "date" ? (
          <RuntimeDatePicker
            field={field}
            errorMessage={error}
            props={props}
            value={textValue}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "dateRange" ? (
          <RuntimeDateRangePicker
            field={field}
            errorMessage={error}
            props={props}
            value={multiValues}
            onChange={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "attachment" || field.type === "imageUpload" ? (
          <RuntimeUpload
            field={field}
            props={props}
            value={value}
            onFilesCommitted={(nextValue) =>
              onFieldAction(field.id, nextValue, "onChange")
            }
          />
        ) : null}
        {field.type === "button" ? (
          <Button
            type="button"
            isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
            onPress={() => {
              if (props.isReadOnly) return;
              onFieldAction(field.id, value ?? "", "onClick");
            }}
          >
            {props.buttonText || field.label}
          </Button>
        ) : null}
        {description ? (
          <TextContext.Provider value={null}>
            <Description
              style={{ display: "block" }}
              className="text-sm text-[var(--color-text-secondary)]"
            >
              {description}
            </Description>
          </TextContext.Provider>
        ) : null}
        {error && !usesFieldError ? (
          <TextContext.Provider value={null}>
            <ErrorMessage
              style={{ display: "block" }}
              id={errorId}
              role="alert"
            >
              {error}
            </ErrorMessage>
          </TextContext.Provider>
        ) : null}
        {formulaError ? (
          <TextContext.Provider value={null}>
            <ErrorMessage style={{ display: "block" }}>
              公式错误：{formulaError}
            </ErrorMessage>
          </TextContext.Provider>
        ) : null}
      </div>
    </div>
  );
});

function getInitialValues(
  fields: RuntimeSchemaField[],
  initialValues?: Record<string, unknown>,
) {
  const values: Record<string, unknown> = {};
  const subformIds = new Set(
    fields.filter((field) => field.type === "subform").map((field) => field.id),
  );

  for (const field of fields) {
    if (field.parentGroupId && subformIds.has(field.parentGroupId)) {
      continue;
    }
    if (
      field.type === "description" ||
      field.type === "link" ||
      field.type === "groupContainer" ||
      field.type === "html" ||
      field.type === "tsx"
    ) {
      continue;
    }

    if (field.type === "subform") {
      values[field.id] = Array.isArray(initialValues?.[field.id])
        ? initialValues?.[field.id]
        : [];
      continue;
    }

    if (field.type === "button") {
      values[field.id] =
        initialValues?.[field.id] ?? field.props?.defaultValue ?? "";
      continue;
    }

    if (field.type === "richText") {
      values[field.id] = isRichTextDocument(initialValues?.[field.id])
        ? initialValues![field.id]
        : EMPTY_RICH_TEXT_DOCUMENT;
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
  if (field.type === "serialNumber") {
    return formatRuntimeSerialNumber(field.props ?? {});
  }
  if (field.props?.defaultValueType === "none") {
    if (
      field.type === "checkbox" ||
      field.type === "multiSelect" ||
      field.type === "dateRange"
    ) {
      return [];
    }
    if (field.type === "countryCity") {
      return normalizeCountryCityValue(undefined);
    }
    return "";
  }

  const defaultValue = field.props?.defaultValue;

  if (field.type === "countryCity") {
    return normalizeCountryCityValue(defaultValue);
  }

  if (
    field.type === "checkbox" ||
    field.type === "multiSelect" ||
    field.type === "dateRange"
  ) {
    return Array.isArray(defaultValue) ? defaultValue : [];
  }

  if (field.type === "number") {
    return (
      toOptionalNumber(
        defaultValue as string | number | string[] | undefined,
      ) ?? ""
    );
  }

  return defaultValue ?? "";
}

const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = { type: "doc", content: [] };

function isRichTextDocument(value: unknown): value is RichTextDocument {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content),
  );
}

function formatRuntimeSerialNumber(props: RuntimeFieldProps) {
  if (props.serialNumberRules?.length) {
    return props.serialNumberRules
      .map((rule) => {
        if (rule.type === "fixedText") return rule.value;
        if (rule.type === "formField") return rule.fallback || "{字段}";
        if (rule.type === "submittedDate")
          return formatRuntimeSerialDate(new Date(), rule.format);
        return rule.fixedDigits
          ? String(rule.initialValue).padStart(rule.digits, "0")
          : String(rule.initialValue);
      })
      .join("");
  }
  const initialValue = Math.max(
    1,
    Math.trunc(props.serialNumberInitialValue ?? 1),
  );
  if (!props.serialNumberFixedDigits) return String(initialValue);
  return String(initialValue).padStart(
    Math.max(1, props.serialNumberDigits ?? 4),
    "0",
  );
}

function formatRuntimeSerialDate(
  date: Date,
  format:
    | "year"
    | "yearMonth"
    | "yearMonthDay"
    | "yearMonthDayHourMinute"
    | "yearMonthDayHourMinuteSecond",
) {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  if (format === "year") return String(date.getFullYear());
  if (format === "yearMonth") return day.slice(0, 6);
  if (format === "yearMonthDay") return day;
  const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  return format === "yearMonthDayHourMinute"
    ? `${day}${time}`
    : `${day}${time}${String(date.getSeconds()).padStart(2, "0")}`;
}

function buildInitialRuntimeState(
  fields: RuntimeSchemaField[],
  dataSourceDefinitions: RuntimeDataSource[] | undefined,
  initialValues?: Record<string, unknown>,
): RuntimeRendererState {
  const initialFieldValues = getInitialValues(fields, initialValues);
  const calculated = calculateFormulaValues(fields, initialFieldValues);
  const values = calculated.values;
  const dataSources = getInitialDataSources(dataSourceDefinitions);
  return {
    values,
    dataSources,
    formulaErrors: calculated.errors,
    debugEvent: undefined,
  };
}

function normalizeFieldOptions(
  options?: RuntimeFieldOption[],
  type?: RuntimeFieldType,
): RuntimeFieldOption[] {
  if (options && options.length > 0) {
    return options;
  }

  if (type === "member") {
    return DEFAULT_OPTIONS;
  }

  if (type === "department") {
    return DEFAULT_DEPARTMENT_OPTIONS;
  }

  return DEFAULT_OPTIONS;
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
    type === "richText" ||
    type === "html" ||
    type === "tsx" ||
    type === "radio" ||
    type === "checkbox" ||
    type === "attachment" ||
    type === "imageUpload" ||
    type === "subform"
  );
}

function getRuntimeTitlePosition(
  type: RuntimeFieldType,
  position: RuntimeFieldProps["titlePosition"],
) {
  if (position === "inside" && type !== "singleLineText") {
    return "top";
  }

  return position ?? "top";
}
