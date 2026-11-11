"use client";

import { buildInitialRuntimeState } from "../model/initial-state";
import { RuntimeReadOnlyForm } from "./RuntimeReadOnlyForm";
import { getFormGridTemplateRows } from "./form-grid-layout";
import { notifyRequestError } from "@/shared/lib/notify";
import { getFieldDescription } from "./field-description";
import { normalizeValidationProps } from "../validation-config";
import { validateFormSubmission } from "../api";
import { notify } from "@/shared/lib/notify";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@heroui/react";
import { normalizeActionPanelCode } from "@/features/form-model/action-panel-code";
import { calculateFormulaValues } from "@/features/form-runtime/model/form-formula";
import { compileRuntimeActionModule, createRuntimeDebugEventId, runRuntimeActionHandler, shouldDeduplicateDidMountExecution, stringifyRuntimeDebugValue } from "./runtime-form-action-engine";
import { AssociationDefaultsContext } from "./RuntimeAssociationField";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { getMemberInitialValue } from "./member-default-value";
import type { RuntimeDebugEvent, RuntimeFormRendererProps, RuntimeSchemaField } from "../../form-model/runtime-types";
import { RuntimeTransactionContext } from "./runtime-form-transaction";
import { validateRuntimeFields } from "./runtime-form-validation";
import { createRuntimeFormStore, EMPTY_ERRORS, type RuntimeRendererState } from "./runtime-form-store";
import { RuntimeStoreContext, CurrentUserIdContext, EMPTY_ASSETS } from "./runtime-field-context";
import { DEFAULT_COLUMN_GAP, DEFAULT_ROW_GAP, isTopAlignedRuntimeField } from "./runtime-field-layout";
import { ConnectedRuntimeFieldNode } from "./RuntimeFieldNode";

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
} from "../../form-model/runtime-types";

export function RuntimeFormSurface({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function RuntimeFormRenderer(props: RuntimeFormRendererProps) {
  return props.readOnlyDisplay
    ? props.runLoadActionInReadOnly
      ? <ReadOnlyActionForm {...props} />
      : <RuntimeReadOnlyForm schema={props.schema} values={props.initialValues} valuePatch={props.valuePatch} />
    : <InteractiveRuntimeFormRenderer {...props} />;
}

function ReadOnlyActionForm(props: RuntimeFormRendererProps) {
  const { schema, initialValues, valuePatch } = props;
  const paramsKey = JSON.stringify(props.urlParams ?? {});
  const code = normalizeActionPanelCode(schema.pageProps?.actionPanel);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const executed = useRef<string | null>(null);
  const inputKey = JSON.stringify([schema.formUuid, code, initialValues, valuePatch, paramsKey]);
  useEffect(() => {
    if (executed.current === inputKey) return;
    executed.current = inputKey;
    const values = structuredClone({ ...initialValues, ...valuePatch?.values });
    const actionModule = compileRuntimeActionModule(code);
    if (actionModule.error) notify.error("页面加载动作执行失败", { description: actionModule.error });
    else runRuntimeActionHandler({
      actionModule, fields: schema.fields, handlerName: "didMount", fieldId: "", eventName: "didMount",
      values, dataSources: {}, urlParams: JSON.parse(paramsKey), value: undefined,
      onError: message => notify.error("页面加载动作执行失败", { description: message }),
    });
    setResult(values);
  }, [inputKey, code, initialValues, valuePatch, schema.fields, paramsKey]);
  return <RuntimeReadOnlyForm schema={schema} values={result ?? initialValues} valuePatch={result ? undefined : valuePatch} />;
}

function InteractiveRuntimeFormRenderer({
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
  const { user } = useAuth();
  const userId = user?.id;
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
  const [store] = useState(() => createRuntimeFormStore(
    buildInitialRuntimeState(
      fields,
      schema.pageProps?.dataSources,
      initialValues,
      userId,
      !recordUuid && !isReadOnly,
    ),
  ));
  const runtimeState = store.getState();
  const pendingMemberDefaults = useRef(new Set(fields.filter((field) =>
    field.type === "member" && field.props?.defaultValueType === "currentUser"
    && !userId && !recordUuid && !isReadOnly && initialValues?.[field.id] == null
    && !fields.some((parent) => parent.id === field.parentGroupId && parent.type === "subform"),
  ).map((field) => field.id)));
  const values = runtimeState.values;
  const hasSubmittedRef = useRef(false);
  const remoteValidationRef = useRef<{ values: Record<string, unknown>; errors: Record<string, string> } | null>(null);
  const [validatingSubmission, setValidatingSubmission] = useState(false);
  const transactionDepthRef = useRef(0);
  const transactionChangesRef = useRef(new Set<string>());
  const validateState = useCallback((state: RuntimeRendererState) => hasSubmittedRef.current ? {
    ...validateRuntimeFields(fields, state.values),
    ...(remoteValidationRef.current?.values === state.values ? remoteValidationRef.current.errors : EMPTY_ERRORS),
  } : EMPTY_ERRORS, [fields]);
  const setRuntimeState = useCallback((update: RuntimeRendererState | ((current: RuntimeRendererState) => RuntimeRendererState)) => {
    const next = typeof update === "function" ? update(store.getState()) : update;
    if (transactionDepthRef.current) store.publish(next);
    else store.publish(next, validateState(next));
  }, [store, validateState]);
  const runTransaction = useCallback((action: () => void) => store.batch(() => {
    transactionDepthRef.current++;
    try { action(); } finally {
      transactionDepthRef.current--;
      if (!transactionDepthRef.current && transactionChangesRef.current.size) {
        const changedFieldIds = transactionChangesRef.current;
        transactionChangesRef.current = new Set();
        const current = store.getState();
        const calculated = calculateFormulaValues(fields, current.values, { changedFieldIds, previousErrors: current.formulaErrors });
        setRuntimeState({ ...current, values: calculated.values, formulaErrors: calculated.errors });
      }
    }
  }), [store, fields, setRuntimeState]);
  useEffect(() => {
    let previous = store.getState();
    onValuesChange?.(previous.values);
    function notifySubscribers() {
      const next = store.getState();
      if (next.values !== previous.values) onValuesChange?.(next.values);
      if (next.debugEvent && next.debugEvent.id !== emittedDebugEventIdRef.current) {
        emittedDebugEventIdRef.current = next.debugEvent.id;
        onDebugEvent?.(next.debugEvent);
      }
      previous = next;
    }
    notifySubscribers();
    return store.subscribe(notifySubscribers);
  }, [store, onValuesChange, onDebugEvent]);

  useEffect(() => {
    if (!userId || recordUuid || isReadOnly || !pendingMemberDefaults.current.size) return;
    const timer = window.setTimeout(() => {
      const pending = new Set(pendingMemberDefaults.current);
      pendingMemberDefaults.current.clear();
      setRuntimeState((current) => {
        const nextValues = { ...current.values };
        for (const field of fields) {
          const existing = nextValues[field.id];
          if (pending.has(field.id) && (existing == null || existing === "" || (Array.isArray(existing) && !existing.length))) {
            nextValues[field.id] = getMemberInitialValue(field.props ?? {}, { userId });
          }
        }
        const calculated = calculateFormulaValues(fields, nextValues);
        return { ...current, values: calculated.values, formulaErrors: calculated.errors };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fields, isReadOnly, recordUuid, userId, setRuntimeState]);

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
  }, [fields, valuePatch, setRuntimeState]);
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
  }, [actionModule, didMountExecutionKey, fields, isReadOnly, urlParams, setRuntimeState]);

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
              "separator",
            ].includes(field.type),
        )
        .map((field) => field.id),
    [fields],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingValidationRef.current || submitting) return;
    const submitValues = calculateFormulaValues(fields, store.getValues()).values;
    hasSubmittedRef.current = true;
    if (Object.keys(validateRuntimeFields(fields, submitValues)).length > 0) {
      setRuntimeState((current) => ({ ...current, values: submitValues }));
      return;
    }
    const submitDataSources = { ...store.getState().dataSources };
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
        if (store.getValues() !== calculatedSubmit.values)
          return;
        if (Object.keys(errors).length) {
          remoteValidationRef.current = { values: payload, errors };
          setRuntimeState((current) => ({ ...current, values: payload }));
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
      pendingMemberDefaults.current.delete(fieldId);
      const current = { ...runtimeContextRef.current, ...store.getState() };
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

      const changedFieldIds = new Set([fieldId, ...Object.keys(nextValues).filter((id) => !Object.is(current.values[id], nextValues[id]))]);
      if (transactionDepthRef.current) {
        changedFieldIds.forEach((id) => transactionChangesRef.current.add(id));
      }
      const calculated = transactionDepthRef.current ? { values: nextValues, errors: current.formulaErrors } : calculateFormulaValues(current.fields, nextValues, {
        changedFieldIds,
        previousErrors: current.formulaErrors,
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
    [store, setRuntimeState],
  );

  return (
    <CurrentUserIdContext.Provider value={userId}>
    <AssociationDefaultsContext.Provider value={!recordUuid && !isReadOnly}>
    <RuntimeStoreContext.Provider value={store}>
    <RuntimeTransactionContext.Provider value={runTransaction}>
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
            gridTemplateRows: getFormGridTemplateRows(visibleRootFields),
            columnGap: DEFAULT_COLUMN_GAP,
            rowGap: DEFAULT_ROW_GAP,
          }}
        >
          {visibleRootFields.map((field) => (
            <div
              key={field.id}
              className={[
                "flex min-w-0",
                field.type === "separator" ||
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
              <ConnectedRuntimeFieldNode
                childFieldsByParent={childFieldsByParent}
                field={field}
                definedComponentWritableFieldIds={
                  definedComponentWritableFieldIds
                }
                definedAssets={schema.pageProps?.assets ?? EMPTY_ASSETS}
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
    </RuntimeTransactionContext.Provider>
    </RuntimeStoreContext.Provider>
    </AssociationDefaultsContext.Provider>
    </CurrentUserIdContext.Provider>
  );
}

export { RuntimeFieldNode } from "./RuntimeFieldNode";
export type { FormFieldRenderMode, SharedFormFieldProps } from "./RuntimeFieldNode";
export { FormField } from "./RuntimeFormField";
