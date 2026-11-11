"use client";

import { AssociationFillControl } from "./AssociationFillProperties";
import { PropertyButton, PropertyInput, PropertySelectField, PropertySwitch } from "../property-panel/PropertyControls";

import { FormSelect, type FormSelectOption } from "@/features/form-controls/components/FormSelect";
import { FieldSelect } from "@/features/form-controls/components/FieldSelect";

import { useEffect, useState } from "react";

import { Label, Radio, RadioGroup, Tabs } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import type { DesignerFieldProps } from "../CompTool";

import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";
import { getFormSchema } from "@/features/form-designer";
import { getAppForms } from "@/features/application/resources";

import { PropertyGroup, PropertyRow } from "../property-panel/PropertyLayout";

import { getAssociationMainTableFields } from "../../association-fill-fields";

type AssociationFormSummary = FormSelectOption;
import type { AssociationSchemaField } from "./association-types";

export function AssociationFormProperties({
  field,
  fields,
  onPropsChange,
}: {
  field: PlacedField;
  fields: PlacedField[];
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [isDisplayOpen, setDisplayOpen] = useState(false);
  const [forms, setForms] = useState<AssociationFormSummary[]>([]);
  const [schemaFields, setSchemaFields] = useState<AssociationSchemaField[]>(
    [],
  );
  const appId =
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("appId") ?? "");
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;

    void getAppForms(appId)
      .then((nextForms) => {
        if (!cancelled) {
          setForms(nextForms.filter((form) => form.id !== field.id));
        }
      })
      .catch(() => {
        if (!cancelled) setForms([]);
      });

    return () => {
      cancelled = true;
    };
  }, [appId, field.id]);

  useEffect(() => {
    const formId = field.props.associationFormId;
    let cancelled = false;
    if (!formId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setSchemaFields([]);
      });
    } else
      void getFormSchema({
        path: { formUuid: formId },
        responseStyle: "fields",
      })
        .then(({ data, error }) => {
          if (cancelled) return;
          const schema = data?.data?.schema as
            | { fields?: AssociationSchemaField[] }
            | undefined;
          setSchemaFields(
            !error && data?.code === 0 ? (schema?.fields ?? []) : [],
          );
        })
        .catch(() => {
          if (!cancelled) setSchemaFields([]);
        });
    return () => {
      cancelled = true;
    };
  }, [field.props.associationFormId]);

  function chooseForm(form: AssociationFormSummary) {
    update({
      defaultValueType: "none",
      defaultValue: "",
      defaultValueFormula: "",
      defaultValueLinkage: "",
      associationDefaultRules: [],
      associationFormId: form.id,
      associationFormName: form.name,
      associationAppId: form.appId ?? appId,
      associationPrimaryFieldId: "",
      associationSecondaryFieldId: "",
      associationTableFieldIds: [],
      associationTableFieldMode: "default",
      associationFilters: [],
      associationFiltersEnabled: false,
      associationFills: [],
      associationSubformFills: [],
      associationFillsEnabled: false,
      associationSorts: [],
      associationSortsEnabled: false,
    });
  }

  const sourceMainFields = getAssociationMainTableFields(schemaFields);
  const sourceSubforms = schemaFields.filter((item) => item.type === "subform");
  const currentParent = field.parentGroupId
    ? fields.find((item) => item.id === field.parentGroupId)
    : null;
  const currentSubformId =
    currentParent?.type === "subform" ? currentParent.id : null;
  const targetMainFields = getAssociationMainTableFields(fields);
  const targetSubforms = fields.filter((item) => item.type === "subform");
  return (
    <>
      <PropertyGroup title="关联属性">
        <PropertyRow
          label={
            <span>
              关联表单 <span className="text-danger">*</span>
            </span>
          }
        >
          <div className="min-w-0 flex-1">
            <FormSelect
              appId={appId}
              forms={forms}
              formTypes={["normal", "workflow"]}
              value={field.props.associationFormId ?? ""}
              placeholder="选择关联表单"
              onChange={() => {}}
              onFormSelect={chooseForm}
            />
          </div>
        </PropertyRow>
        <PropertyRow
          label={
            <span>
              显示设置 <span className="text-danger">*</span>
            </span>
          }
        >
          <PropertyButton
            variant="ghost"
            isDisabled={!field.props.associationFormId}
            onPress={() => setDisplayOpen(true)}
            className="min-w-0 flex-1 justify-between px-2"
          >
            <span>
              {field.props.associationPrimaryFieldId ? "已配置" : "未配置"}
            </span>
            <span>设置</span>
          </PropertyButton>
        </PropertyRow>
        <AssociationFilterControl
          enabled={Boolean(field.props.associationFiltersEnabled)}
          filters={field.props.associationFilters ?? []}
          fields={sourceMainFields}
          onEnabledChange={(enabled) =>
            update({
              associationFiltersEnabled: enabled,
              ...(!enabled ? { associationFilters: [] } : {}),
            })
          }
          onChange={(associationFilters) => update({ associationFilters })}
        />
        <AssociationFillControl
          enabled={Boolean(field.props.associationFillsEnabled)}
          currentSubformId={currentSubformId}
          rules={field.props.associationFills ?? []}
          sourceFields={sourceMainFields}
          sourceSchemaFields={schemaFields}
          sourceSubforms={sourceSubforms}
          subformRules={field.props.associationSubformFills ?? []}
          summary={
            field.props.associationFills?.length ||
            field.props.associationSubformFills?.length
              ? "已配置"
              : "未配置"
          }
          targetMainFields={targetMainFields}
          targetSubforms={targetSubforms}
          targetFields={fields.filter((item) => item.id !== field.id)}
          onEnabledChange={(enabled) =>
            update({
              associationFillsEnabled: enabled,
              ...(!enabled
                ? { associationFills: [], associationSubformFills: [] }
                : {}),
            })
          }
          onChange={(associationFills, associationSubformFills) =>
            update({ associationFills, associationSubformFills })
          }
        />
        <AssociationSortControl
          enabled={Boolean(field.props.associationSortsEnabled)}
          summary={
            field.props.associationSorts?.length
              ? `已配置 ${field.props.associationSorts.length} 条`
              : "未配置"
          }
          fields={schemaFields}
          onEnabledChange={(enabled) =>
            update({
              associationSortsEnabled: enabled,
              ...(!enabled ? { associationSorts: [] } : {}),
            })
          }
          onChange={(associationSorts) =>
            update({
              associationSorts: associationSorts as NonNullable<
                DesignerFieldProps["associationSorts"]
              >,
            })
          }
        />
      </PropertyGroup>
      <AssociationDisplaySettingsModal
        key={`${field.props.associationFormId}:${isDisplayOpen}`}
        isOpen={isDisplayOpen}
        onOpenChange={setDisplayOpen}
        field={field}
        fields={schemaFields}
        onSave={update}
      />
    </>
  );
}

function AssociationDisplaySettingsModal({
  field,
  fields,
  isOpen,
  onOpenChange,
  onSave,
}: {
  field: PlacedField;
  fields: AssociationSchemaField[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (props: DesignerFieldProps) => void;
}) {
  const [primary, setPrimary] = useState(
    field.props.associationPrimaryFieldId ?? "",
  );
  const [secondary, setSecondary] = useState(
    field.props.associationSecondaryFieldId ?? "",
  );
  const [tableFields, setTableFields] = useState(
    field.props.associationTableFieldIds ?? [],
  );
  const [tableMode, setTableMode] = useState<"default" | "custom">(
    field.props.associationTableFieldMode ??
      (field.props.associationTableFieldIds?.length ? "custom" : "default"),
  );
  const fieldOptions = fields.map((item) => ({
    key: item.id,
    label: item.label,
    fieldType: item.type,
  }));
  const [tab, setTab] = useState<"dropdown" | "table">("dropdown");
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop isDismissable>
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="w-[min(960px,96vw)]">
            <Modal.Header>
              <Modal.Heading>显示设置</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Tabs
                variant="secondary"
                selectedKey={tab}
                onSelectionChange={(key) => setTab(key as "dropdown" | "table")}
              >
                <Tabs.List aria-label="关联表单显示设置">
                  <Tabs.Tab id="dropdown" className="px-4 py-2">
                    下拉菜单显示字段
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="table" className="px-4 py-2">
                    数据表展示字段
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs>
              {tab === "dropdown" ? (
                <div className="grid grid-cols-2 gap-4">
                  <FieldSelect
                    label="主要信息"
                    isRequired
                    options={fieldOptions}
                    value={primary}
                    onChange={setPrimary}
                  />
                  <FieldSelect
                    label="次要信息"
                    options={fieldOptions}
                    value={secondary}
                    onChange={setSecondary}
                  />
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <RadioGroup
                    aria-label="设置选择数据中表格的显示字段"
                    orientation="horizontal"
                    value={tableMode}
                    onChange={(value) =>
                      setTableMode(value as "default" | "custom")
                    }
                  >
                    <Label>设置选择数据中表格的显示字段</Label>
                    <Radio value="default">
                      <Radio.Content>
                        <Radio.Control>
                          <Radio.Indicator />
                        </Radio.Control>
                        <Label>默认</Label>
                      </Radio.Content>
                    </Radio>
                    <Radio value="custom">
                      <Radio.Content>
                        <Radio.Control>
                          <Radio.Indicator />
                        </Radio.Control>
                        <Label>自定义</Label>
                      </Radio.Content>
                    </Radio>
                  </RadioGroup>
                  {tableMode === "custom" ? (
                    <FieldSelect
                      label="数据表展示字段"
                      options={fieldOptions}
                      selectionMode="multiple"
                      value={tableFields}
                      onChange={setTableFields}
                    />
                  ) : null}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2 px-6 py-3">
              <PropertyButton variant="secondary" onPress={() => onOpenChange(false)}>
                取消
              </PropertyButton>
              <PropertyButton
                isDisabled={!primary}
                onPress={() => {
                  onSave({
                    associationPrimaryFieldId: primary,
                    associationSecondaryFieldId: secondary,
                    associationTableFieldMode: tableMode,
                    associationTableFieldIds:
                      tableMode === "default"
                        ? fields.map((item) => item.id)
                        : tableFields,
                  });
                  onOpenChange(false);
                }}
              >
                确定
              </PropertyButton>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function AssociationSelect({
  fields,
  label,
  onChange,
  value,
}: {
  fields: AssociationSchemaField[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      {label}
      <AssociationInlineSelect
        ariaLabel={label}
        className="mt-1 w-full"
        fields={fields}
        placeholder="请选择"
        allowEmpty
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

type AssociationFilter = NonNullable<
  DesignerFieldProps["associationFilters"]
>[number];

function AssociationFilterControl({
  enabled,
  fields,
  filters,
  onChange,
  onEnabledChange,
}: {
  enabled: boolean;
  fields: AssociationSchemaField[];
  filters: AssociationFilter[];
  onChange: (filters: AssociationFilter[]) => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = filters.length ? `已配置 ${filters.length} 条` : "未配置";
  return (
    <PropertyRow label="数据筛选">
      <PropertySwitch
        aria-label="启用数据筛选"
        isSelected={enabled}
        onChange={onEnabledChange}
        className="shrink-0"
       />
      {enabled ? (
        <PropertyInput
          aria-label="数据筛选配置"
          readOnly
          value={summary}
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1"
        />
      ) : null}
      <AssociationFilterModal
        key={`${open}:${JSON.stringify(filters)}`}
        fields={fields}
        filters={filters}
        isOpen={open}
        onChange={setOpen}
        onSave={onChange}
      />
    </PropertyRow>
  );
}

function AssociationFilterModal({
  fields,
  filters,
  isOpen,
  onChange,
  onSave,
}: {
  fields: AssociationSchemaField[];
  filters: AssociationFilter[];
  isOpen: boolean;
  onChange: (open: boolean) => void;
  onSave: (filters: AssociationFilter[]) => void;
}) {
  const [rules, setRules] = useState<AssociationFilter[]>(() =>
    filters.length ? filters : [{ fieldId: "", operator: "eq", value: "" }],
  );
  const updateRule = (index: number, patch: Partial<AssociationFilter>) =>
    setRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  const removeRule = (index: number) =>
    setRules((current) =>
      current.length === 1
        ? current
        : current.filter((_, ruleIndex) => ruleIndex !== index),
    );
  const addRule = () =>
    setRules((current) => [
      ...current,
      { fieldId: "", operator: "eq", value: "" },
    ]);
  const canSave =
    rules.length > 0 &&
    rules.every((rule) => rule.fieldId && rule.value.trim());
  return (
    <Modal isOpen={isOpen} onOpenChange={onChange}>
      <Modal.Backdrop isDismissable>
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="flex h-[min(640px,86vh)] w-[min(920px,96vw)] flex-col overflow-hidden">
            <Modal.Header>
              <Modal.Heading>数据筛选</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <p className="mb-6">
                数据会按照如下条件进行筛选，前者为关联表单中的字段。
              </p>
              <div className="relative space-y-4 pl-11 before:absolute before:bottom-5 before:left-5 before:top-5">
                {rules.map((rule, index) => (
                  <div
                    key={`${index}-${rule.fieldId}`}
                    className="relative flex flex-wrap items-center gap-2"
                  >
                    <span className="absolute -left-11 top-1/2 flex h-7 w-10 -translate-y-1/2 items-center justify-center">
                      {index === 0 ? "当" : "且"}
                    </span>
                    <AssociationInlineSelect
                      ariaLabel="筛选字段"
                      className="w-40"
                      fields={fields}
                      value={rule.fieldId}
                      onChange={(fieldId) => updateRule(index, { fieldId })}
                    />
                    <AssociationInlineSelect
                      ariaLabel="比较方式"
                      className="w-28"
                      fields={[
                        { id: "eq", label: "等于", type: "" },
                        { id: "neq", label: "不等于", type: "" },
                        { id: "contains", label: "包含", type: "" },
                      ]}
                      value={rule.operator}
                      onChange={(operator) => updateRule(index, { operator })}
                    />
                    <PropertyInput
                      aria-label="筛选值"
                      className="w-52"
                      placeholder="请输入匹配值"
                      value={rule.value}
                      onChange={(event) =>
                        updateRule(index, { value: event.currentTarget.value })
                      }
                    />
                    <PropertyButton
                      isIconOnly
                      aria-label="删除条件"
                      variant="ghost"
                      isDisabled={rules.length === 1}
                      onPress={() => removeRule(index)}
                      className="w-8"
                    >
                      删除
                    </PropertyButton>
                    <PropertyButton
                      isIconOnly
                      aria-label="添加条件"
                      variant="ghost"
                      onPress={addRule}
                      className="w-8"
                    >
                      +
                    </PropertyButton>
                  </div>
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2 px-6 py-3">
              <PropertyButton variant="secondary" onPress={() => onChange(false)}>
                取消
              </PropertyButton>
              <PropertyButton
                isDisabled={!canSave}
                onPress={() => {
                  onSave(rules);
                  onChange(false);
                }}
              >
                确定
              </PropertyButton>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function AssociationInlineSelect({
  allowEmpty = false,
  ariaLabel,
  className,
  fields,
  onChange,
  placeholder = "字段名称",
  value,
}: {
  allowEmpty?: boolean;
  ariaLabel: string;
  className: string;
  fields: AssociationSchemaField[];
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return <PropertySelectField
    ariaLabel={ariaLabel} className={className} value={value} onChange={onChange} placeholder={placeholder}
    options={[...(allowEmpty ? [{ value: "", label: placeholder }] : []), ...fields.map((field) => ({ value: field.id, label: field.label }))]}
  />;
}

function AssociationSortControl({
  enabled,
  fields,
  onChange,
  onEnabledChange,
  summary,
}: {
  enabled: boolean;
  fields: AssociationSchemaField[];
  onChange: (
    rules: Array<{ fieldId: string; direction: "asc" | "desc" }>,
  ) => void;
  onEnabledChange: (enabled: boolean) => void;
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const [fieldId, setFieldId] = useState("");
  const [value, setValue] = useState("");
  return (
    <PropertyRow label="数据排序">
      <PropertySwitch
        aria-label="启用数据排序"
        isSelected={enabled}
        onChange={onEnabledChange}
        className="shrink-0"
       />
      {enabled ? (
        <PropertyInput
          aria-label="数据排序配置"
          readOnly
          value={summary}
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1"
        />
      ) : null}
      <Modal isOpen={open} onOpenChange={setOpen}>
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="w-[min(440px,92vw)]">
              <Modal.Header>
                <Modal.Heading>数据排序</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-3">
                <AssociationSelect
                  label="字段"
                  value={fieldId}
                  fields={fields}
                  onChange={setFieldId}
                />
                <AssociationSelect
                  label="方向"
                  value={value || "asc"}
                  fields={[
                    { id: "asc", label: "升序", type: "" },
                    { id: "desc", label: "降序", type: "" },
                  ]}
                  onChange={setValue}
                />
              </Modal.Body>
              <Modal.Footer>
                <PropertyButton
                  isDisabled={!fieldId}
                  onPress={() => {
                    onChange([
                      {
                        fieldId,
                        direction: (value || "asc") as "asc" | "desc",
                      },
                    ]);
                    setOpen(false);
                  }}
                >
                  确定
                </PropertyButton>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </PropertyRow>
  );
}
