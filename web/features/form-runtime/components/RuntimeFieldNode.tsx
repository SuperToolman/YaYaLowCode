"use client";

import { getFieldDefaultValue } from "../model/initial-state";
import { FormSeparator } from "./FormSeparator";
import { getFormGridTemplateRows } from "./form-grid-layout";
import { memo, useContext, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Button, ErrorMessage, ButtonGroup } from "@heroui/react";
import { TextContext } from "react-aria-components";
import { TrashBin } from "@gravity-ui/icons";
import { RuntimeAssociationField } from "./RuntimeAssociationField";
import { RuntimeSubformTable } from "./RuntimeSubformTable";
import { SubformHeader } from "./SubformLayout";
import { RuntimeDefinedComponent } from "./RuntimeDefinedComponent";
import type { RuntimeFieldProps, RuntimePageAsset, RuntimeSchemaField } from "../../form-model/runtime-types";
import { FormGroup } from "./FormGroup";
import { getSubformValidationKey } from "./runtime-form-validation";
import { RuntimeStoreContext, CurrentUserIdContext, EMPTY_ASSETS, EMPTY_IDS, NO_FIELD_ACTION, useRuntimeFieldSnapshot, useRuntimeValues } from "./runtime-field-context";
import { DEFAULT_COLUMN_GAP, DEFAULT_ROW_GAP, isTopAlignedRuntimeField } from "./runtime-field-layout";
import { FormField } from "./RuntimeFormField";

export type FormFieldRenderMode = "runtime" | "designer";

export type SharedFormFieldProps = {
  childFieldsByParent: Map<string, RuntimeSchemaField[]>;
  definedComponentWritableFieldIds?: string[];
  definedAssets?: RuntimePageAsset[];
  field: RuntimeSchemaField;
  formulaErrors?: Record<string, string>;
  formulaError?: string;
  mode?: FormFieldRenderMode;
  onFieldAction?: (
    fieldId: string,
    nextValue: unknown,
    eventName?: string,
  ) => void;
  value: unknown;
  values: Record<string, unknown>;
};

export const ConnectedRuntimeFieldNode = memo(function ConnectedRuntimeFieldNode(props: Omit<SharedFormFieldProps, "value" | "values" | "formulaErrors">) {
  const snapshot = useRuntimeFieldSnapshot(props.field.type === "groupContainer" ? "" : props.field.id);
  const values = useRuntimeValues(props.field.type === "html" || props.field.type === "tsx");
  return <RuntimeFieldNode {...props} value={snapshot.value} values={values} formulaError={snapshot.formulaError} />;
});

export function RuntimeFieldNode({
  childFieldsByParent,
  definedComponentWritableFieldIds,
  definedAssets,
  field,
  formulaErrors,
  formulaError,
  mode = "runtime",
  onFieldAction,
  value,
  values,
}: SharedFormFieldProps) {
  const fieldSnapshot = useRuntimeFieldSnapshot(field.id);
  const runtimeStore = useContext(RuntimeStoreContext);
  const readOnlyField = useMemo(() =>
    mode === "designer"
      ? {
          ...field,
          props: {
            ...field.props,
            isDisabled: true,
            isReadOnly: true,
          },
        }
      : field, [field, mode]);
  const emitFieldAction =
    mode === "designer"
      ? NO_FIELD_ACTION
      : (onFieldAction ?? NO_FIELD_ACTION);

  const onValueChange = useCallback((nextValue: unknown) => emitFieldAction(field.id, nextValue, "onChange"), [emitFieldAction, field.id]);

  if (readOnlyField.type === "separator") {
    return <FormSeparator label={field.label} {...field.props} />;
  }

  if (readOnlyField.type === "subform") {
    const childFields = childFieldsByParent.get(field.id) ?? [];
    return (
      <RuntimeSubform
        field={readOnlyField}
        childFields={childFields}
        mode={mode}
        value={value}
        onChange={onValueChange}
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
        groupTitleType={field.props?.groupTitleType}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${field.colSpan ?? 1}, minmax(0, 1fr))`,
            gridAutoRows: "minmax(68px, auto)",
            gridTemplateRows: getFormGridTemplateRows(childFields, field.row),
            columnGap: DEFAULT_COLUMN_GAP,
            rowGap: DEFAULT_ROW_GAP,
          }}
        >
          {childFields.map((child) => (
            <div
              key={child.id}
              className={[
                "flex min-w-0",
                child.type === "separator" ||
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
              <GroupChildField
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
        errorMessage={fieldSnapshot.error}
        value={value}
        onChange={onValueChange}
        onFill={(source) => {
          const fill = () => applyAssociationFillRules(readOnlyField.props, source, emitFieldAction);
          if (runtimeStore) runtimeStore.batch(fill); else fill();
        }}
      />
    );
  }

  if (readOnlyField.type === "html" || readOnlyField.type === "tsx") {
    return (
      <RuntimeDefinedComponent
        type={readOnlyField.type}
        code={readOnlyField.props?.code}
        allowedResourceOrigins={readOnlyField.props?.allowedResourceOrigins}
        allowedFieldIds={definedComponentWritableFieldIds ?? EMPTY_IDS}
        assets={definedAssets ?? EMPTY_ASSETS}
        values={values}
        isReadOnly
        onSetFieldValue={emitFieldAction}
      />
    );
  }

  return (
    <FormField
      field={readOnlyField}
      formulaError={formulaError ?? formulaErrors?.[field.id]}
      onFieldAction={emitFieldAction}
      value={value}
    />
  );
}

function GroupChildField(props: SharedFormFieldProps) {
  if (props.mode === "designer") return <RuntimeFieldNode {...props} />;
  return <ConnectedRuntimeFieldNode childFieldsByParent={props.childFieldsByParent}
    definedComponentWritableFieldIds={props.definedComponentWritableFieldIds} definedAssets={props.definedAssets}
    field={props.field} onFieldAction={props.onFieldAction} />;
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
  const store = useContext(RuntimeStoreContext);
  const subformError = useRuntimeFieldSnapshot(field.id).error;
  const userId = useContext(CurrentUserIdContext);
  const props = field.props ?? {};
  const description =
    props.description?.trim() === "可拖入普通字段作为表格列。"
      ? ""
      : props.description?.trim();
  const rows = useMemo(() => Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [], [value]);
  const rowsRef = useRef(rows);
  useLayoutEffect(() => { rowsRef.current = rows; }, [rows]);
  const maxRows = props.subformMaxRows ?? 500;
  const isReadOnly = Boolean(props.isDisabled || props.isReadOnly);
  const showActions = !isReadOnly;

  const updateCell = useCallback((rowIndex: number, fieldId: string, nextValue: unknown) => {
    const currentRows = store?.getValues()[field.id] ?? rowsRef.current;
    if (!Array.isArray(currentRows)) return;
    onChange(currentRows.map((row, index) => index === rowIndex ? { ...row, [fieldId]: nextValue } : row));
  }, [store, field.id, onChange]);

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
        childFields.map((child) => [child.id, getFieldDefaultValue(child, userId)]),
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
      <SubformHeader label={field.label} description={description}>
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
      </SubformHeader>
      <RuntimeSubformTable
        childFields={childFields}
        props={props}
        rows={rows}
        showActions={showActions}
        renderCell={(child, row, rowIndex) => (
          <SubformCell field={child} mode={mode} rowIndex={rowIndex}
            validationKey={getSubformValidationKey(field.id, rowIndex, child.id)}
            value={row[child.id]} onUpdate={updateCell} />
        )}
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
      {subformError ? (
        <TextContext.Provider value={null}>
          <ErrorMessage style={{ display: "block" }}>
            {subformError}
          </ErrorMessage>
        </TextContext.Provider>
      ) : null}
    </section>
  );
}

const SubformCell = memo(function SubformCell({ field, mode, rowIndex, validationKey, value, onUpdate }: {
  field: RuntimeSchemaField; mode: FormFieldRenderMode; rowIndex: number; validationKey: string; value: unknown;
  onUpdate: (rowIndex: number, fieldId: string, value: unknown) => void;
}) {
  const error = useRuntimeFieldSnapshot(validationKey).error;
  const renderField = useMemo(() => mode === "designer" ? { ...field, props: { ...field.props, isDisabled: true, isReadOnly: true } } : field, [field, mode]);
  const onChange = useCallback((nextValue: unknown) => onUpdate(rowIndex, field.id, nextValue), [onUpdate, rowIndex, field.id]);
  const onFieldAction = useCallback((_: string, nextValue: unknown) => onChange(nextValue), [onChange]);
  return field.type === "associationFormField"
    ? <RuntimeAssociationField field={renderField} errorMessage={error} value={value} showLabel={false} onChange={onChange} onFill={NO_FIELD_ACTION} />
    : <FormField field={renderField} validationKey={validationKey} value={value} showLabel={false} onFieldAction={onFieldAction} />;
});
