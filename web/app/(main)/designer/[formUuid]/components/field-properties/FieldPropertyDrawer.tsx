/**
 * 字段属性抽屉
 * */

"use client";

import { useEffect, useMemo, useState } from "react";
import type { Key } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Button,
  Checkbox,
  Input,
  ListBox,
  Select,
  Switch,
  Tabs,
  Popover,
} from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import type { DesignerComponentType, DesignerFieldProps, SerialNumberRule } from "../CompTool";
import { isChoiceFieldType } from "../../designer-options";
import type {
  FieldPropsChangeHandler,
  PlacedField,
} from "../../designer-types";
import {
  getFormSchema,
  listApps,
  listRoles,
  listUsers,
} from "../../../../../lib/api-client";
import { getAppForms } from "../../../../../lib/app-resources";
import { mapWithConcurrency } from "../../../../../lib/async";
import { DefaultValueEditor } from "./DefaultValueEditor";
import { OptionsEditor } from "./OptionsEditor";
import { CascaderDataSourceEditor } from "./CascaderDataSourceEditor";
import {
  CodeToken,
  IconAction,
  NumberWithActions,
  PanelSwitch,
  PropertyFold,
  PropertyRow,
  TextWithActions,
} from "./PropertyLayout";

const PLACEHOLDER_FIELD_TYPES = new Set<DesignerComponentType>([
  "singleLineText",
  "description",
  "multiLineText",
  "number",
  "select",
  "multiSelect",
  "date",
  "dateRange",
  "attachment",
  "imageUpload",
  "serialNumber",
  "member",
  "department",
  "countryCity",
  "cascader",
]);

const COUNTER_FIELD_TYPES = new Set<DesignerComponentType>([
  "singleLineText",
  "multiLineText",
]);

const TITLE_POSITION_FIELD_TYPES = new Set<DesignerComponentType>([
  "singleLineText",
  "multiLineText",
  "number",
  "radio",
  "checkbox",
  "select",
  "multiSelect",
  "date",
  "dateRange",
  "attachment",
  "imageUpload",
  "member",
  "department",
  "countryCity",
  "associationFormField",
  "cascader",
]);

const INSIDE_TITLE_FIELD_TYPES = new Set<DesignerComponentType>([
  "singleLineText",
]);

type FieldPropertyPanelProps = {
  fields: PlacedField[];
  field: PlacedField | null;
  onDelete: (fieldId: string) => void;
  onLabelChange: (fieldId: string, label: string) => void;
  onPropsChange: FieldPropsChangeHandler;
};

export function FieldPropertyPanel({
  fields,
  field,
  onDelete,
  onLabelChange,
  onPropsChange,
}: FieldPropertyPanelProps) {
  if (!field) {
    return null;
  }

  const supportsPlaceholder = PLACEHOLDER_FIELD_TYPES.has(field.type);
  const supportsCounter = COUNTER_FIELD_TYPES.has(field.type);
  const supportsOptions =
    field.type !== "member" && isChoiceFieldType(field.type);
  const parentField = field.parentGroupId
    ? fields.find((candidate) => candidate.id === field.parentGroupId)
    : null;
  const isSubformChild = parentField?.type === "subform";
  const supportsTitlePosition =
    TITLE_POSITION_FIELD_TYPES.has(field.type) && !isSubformChild;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-[11px] text-[var(--color-text-primary)]">
      <header className="border-b border-[var(--designer-border)] p-1">
        <h2 className="truncate text-xs font-medium text-[var(--color-text-primary)]">
          {field.label}
        </h2>
        <div className="flex min-w-0 items-center gap-1 text-[10px] text-[var(--color-text-secondary)]">
          <span className="shrink-0">{field.type}</span>
          <span aria-hidden>·</span>
          <span className="truncate font-mono">{field.id}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="py-0.5">
          <PropertyFold title="基础属性">
            <PropertyRow label="标题">
              <TextWithActions
                value={field.label}
                onChange={(value) => onLabelChange(field.id, value)}
              />
            </PropertyRow>
            {supportsTitlePosition ? (
              <PropertyRow label="标题位置">
                <TitlePositionSegmented
                  allowInside={INSIDE_TITLE_FIELD_TYPES.has(field.type)}
                  value={field.props.titlePosition ?? "top"}
                  onChange={(titlePosition) =>
                    onPropsChange(field.id, { titlePosition })
                  }
                />
              </PropertyRow>
            ) : null}
            <PropertyRow label="描述">
              <TextWithActions
                value={field.props.description ?? ""}
                onChange={(value) =>
                  onPropsChange(field.id, { description: value })
                }
              />
            </PropertyRow>
            {supportsPlaceholder ? (
              <PropertyRow label="占位提示">
                <TextWithActions
                  value={field.props.placeholder ?? ""}
                  onChange={(value) =>
                    onPropsChange(field.id, { placeholder: value })
                  }
                />
              </PropertyRow>
            ) : null}
            <PropertyRow label="状态">
              <StatusSegmented field={field} onPropsChange={onPropsChange} />
              <IconAction label="表达式" icon={<CodeToken />} />
            </PropertyRow>
            {field.type !== "groupContainer" && field.type !== "member" && field.type !== "serialNumber" && field.type !== "richText" ? (
              <PropertyRow label="默认值" align="start">
                <DefaultValueEditor
                  fields={fields}
                  field={field}
                  onPropsChange={onPropsChange}
                />
              </PropertyRow>
            ) : null}
            {supportsOptions ? (
              <PropertyRow label="选项" align="start">
                <OptionsEditor
                  key={field.id}
                  field={field}
                  onPropsChange={onPropsChange}
                />
              </PropertyRow>
            ) : null}
            {field.type === "cascader" ? (
              <PropertyRow label="数据源" align="start">
                <CascaderDataSourceEditor field={field} onPropsChange={onPropsChange} />
              </PropertyRow>
            ) : null}
            <FieldSpecificProperties
              field={field}
              onPropsChange={onPropsChange}
            />
            {field.type === "html" || field.type === "tsx" ? (
              <CustomCodeProperties field={field} onPropsChange={onPropsChange} />
            ) : null}
            {supportsCounter ? (
              <>
                <PropertyRow label="清除按钮">
                  <PanelSwitch
                    isSelected={Boolean(field.props.showClearButton)}
                    onChange={(value) =>
                      onPropsChange(field.id, { showClearButton: value })
                    }
                  />
                </PropertyRow>
                <PropertyRow label="显示计数">
                  <PanelSwitch
                    isSelected={Boolean(field.props.showCounter)}
                    onChange={(value) =>
                      onPropsChange(field.id, { showCounter: value })
                    }
                  />
                </PropertyRow>
              </>
            ) : null}
          </PropertyFold>

          {field.type === "associationFormField" ? (
            <AssociationFormProperties
              field={field}
              fields={fields}
              onPropsChange={onPropsChange}
            />
          ) : null}

          {field.type === "subform" ? (
            <SubformProperties field={field} onPropsChange={onPropsChange} />
          ) : null}

          {field.type === "serialNumber" ? (
            <SerialNumberProperties field={field} fields={fields} onPropsChange={onPropsChange} />
          ) : null}

          {field.type !== "subform" && field.type !== "serialNumber" ? (
            <PropertyFold title="校验">
              <PropertyRow label="必填">
                <PanelSwitch
                  isSelected={Boolean(field.props.isRequired)}
                  onChange={(value) =>
                    onPropsChange(field.id, { isRequired: value })
                  }
                />
              </PropertyRow>
              {field.type === "number" ? (
                <>
                  <PropertyRow label="最小值">
                    <NumberWithActions
                      value={field.props.minValue}
                      onChange={(value) =>
                        onPropsChange(field.id, { minValue: value })
                      }
                    />
                  </PropertyRow>
                  <PropertyRow label="最大值">
                    <NumberWithActions
                      value={field.props.maxValue}
                      onChange={(value) =>
                        onPropsChange(field.id, { maxValue: value })
                      }
                    />
                  </PropertyRow>
                </>
              ) : null}
            </PropertyFold>
          ) : null}

          <PropertyFold title="HeroUI 组件属性" rightIcon={<CodeToken />}>
            <PropertyRow label="禁用">
              <PanelSwitch
                isSelected={Boolean(field.props.isDisabled)}
                onChange={(value) =>
                  onPropsChange(field.id, { isDisabled: value })
                }
              />
            </PropertyRow>
            <PropertyRow label="只读">
              <PanelSwitch
                isSelected={Boolean(field.props.isReadOnly)}
                onChange={(value) =>
                  onPropsChange(field.id, { isReadOnly: value })
                }
              />
            </PropertyRow>
            {field.type === "multiLineText" ? (
              <PropertyRow label="rows">
                <NumberWithActions
                  min={1}
                  value={field.props.rows}
                  onChange={(value) =>
                    onPropsChange(field.id, {
                      rows: Math.max(1, value ?? 1),
                    })
                  }
                />
              </PropertyRow>
            ) : null}
            {field.type === "number" ? (
              <PropertyRow label="step">
                <NumberWithActions
                  min={0}
                  value={field.props.step}
                  onChange={(value) =>
                    onPropsChange(field.id, { step: value ?? 1 })
                  }
                />
              </PropertyRow>
            ) : null}
          </PropertyFold>
        </div>
      </div>

      <footer className="border-t border-[var(--designer-border)] bg-[var(--designer-surface-soft)] p-1">
        <Button
          fullWidth
          variant="ghost"
          onPress={() => onDelete(field.id)}
          className="h-7 border border-transparent text-[11px] text-[var(--color-danger)] hover:border-[var(--designer-border)] hover:bg-[var(--color-danger-soft)]"
        >
          删除组件
        </Button>
      </footer>
    </div>
  );
}

function CustomCodeProperties({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const origins = (field.props.allowedResourceOrigins ?? []).join(", ");
  const codeLabel = field.type === "html" ? "HTML 源码" : "TSX 源码";

  return (
    <>
      <PropertyRow label={codeLabel} align="start">
        <textarea
          aria-label={codeLabel}
          className="min-h-44 w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-code-bg)] p-2 font-mono text-[11px] leading-5 text-[var(--color-code-text)] outline-none focus:border-[var(--color-primary)]"
          value={field.props.code ?? ""}
          onChange={(event) => onPropsChange(field.id, { code: event.currentTarget.value })}
        />
      </PropertyRow>
      <PropertyRow label="外部资源来源" align="start">
        <input
          aria-label="外部资源来源"
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-primary)]"
          placeholder="https://cdn.example.com, https://api.example.com"
          value={origins}
          onChange={(event) => onPropsChange(field.id, {
            allowedResourceOrigins: event.currentTarget.value
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          })}
        />
      </PropertyRow>
    </>
  );
}

function TitlePositionSegmented({
  allowInside,
  onChange,
  value,
}: {
  allowInside: boolean;
  onChange: (value: NonNullable<DesignerFieldProps["titlePosition"]>) => void;
  value: NonNullable<DesignerFieldProps["titlePosition"]>;
}) {
  const options: Array<{
    value: NonNullable<DesignerFieldProps["titlePosition"]>;
    label: string;
  }> = [
    { value: "top", label: "上" },
    { value: "left", label: "左" },
    ...(allowInside ? [{ value: "inside" as const, label: "内" }] : []),
  ];

  return (
    <div
      role="tablist"
      aria-label="标题位置"
      className="grid h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-[var(--color-bg-subtle)] p-0.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={[
            "min-w-0 overflow-hidden truncate whitespace-nowrap rounded-sm px-1 text-[10px] transition",
            value === option.value
              ? "bg-[var(--designer-surface-solid)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FieldSpecificProperties({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  return (
    <>
      {field.type === "link" ? (
        <>
          <PropertyRow label="链接地址">
            <TextWithActions
              value={field.props.href ?? ""}
              onChange={(value) => onPropsChange(field.id, { href: value })}
            />
          </PropertyRow>
          <PropertyRow label="新窗口">
            <PanelSwitch
              isSelected={field.props.target === "_blank"}
              onChange={(value) =>
                onPropsChange(field.id, {
                  target: value ? "_blank" : "_self",
                })
              }
            />
          </PropertyRow>
        </>
      ) : null}
      {field.type === "member" ? (
        <MemberProperties field={field} onPropsChange={onPropsChange} />
      ) : null}
      {field.type === "countryCity" ? (
        <PropertyRow label="级联深度">
          <NumberWithActions
            max={4}
            min={1}
            value={field.props.locationDepth ?? 3}
            onChange={(value) => onPropsChange(field.id, {
              locationDepth: Math.min(4, Math.max(1, Math.round(value ?? 3))),
            })}
          />
        </PropertyRow>
      ) : null}
      {field.type === "attachment" || field.type === "imageUpload" ? (
        <>
          <PropertyRow label="按钮文字">
            <TextWithActions
              value={field.props.buttonText ?? ""}
              onChange={(value) =>
                onPropsChange(field.id, { buttonText: value })
              }
            />
          </PropertyRow>
          <PropertyRow label="accept">
            <TextWithActions
              value={field.props.accept ?? ""}
              onChange={(value) => onPropsChange(field.id, { accept: value })}
            />
          </PropertyRow>
          <PropertyRow label="多文件">
            <PanelSwitch
              isSelected={Boolean(field.props.multiple)}
              onChange={(value) => onPropsChange(field.id, { multiple: value })}
            />
          </PropertyRow>
          <PropertyRow label="文件大小限制 (MB)">
            <TextWithActions
              value={String(field.props.maxFileSizeMb ?? 20)}
              onChange={(value) => {
                const size = Number(value);
                onPropsChange(field.id, { maxFileSizeMb: Number.isFinite(size) && size > 0 ? size : 20 });
              }}
            />
          </PropertyRow>
        </>
      ) : null}
      {field.type === "button" ? (
        <PropertyRow label="按钮文字">
          <TextWithActions
            value={field.props.buttonText ?? ""}
            onChange={(value) => onPropsChange(field.id, { buttonText: value })}
          />
        </PropertyRow>
      ) : null}
    </>
  );
}

type AssociationFormSummary = { id: string; name: string };
type AssociationApp = { id: string; name: string };
type AssociationSchemaField = {
  id: string;
  label: string;
  type: string;
  parentGroupId?: string | null;
};

function AssociationFormProperties({
  field,
  fields,
  onPropsChange,
}: {
  field: PlacedField;
  fields: PlacedField[];
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [isFormPickerOpen, setFormPickerOpen] = useState(false);
  const [isDisplayOpen, setDisplayOpen] = useState(false);
  const [scope, setScope] = useState<"current" | "cross">("current");
  const [forms, setForms] = useState<AssociationFormSummary[]>([]);
  const [apps, setApps] = useState<AssociationApp[]>([]);
  const [schemaFields, setSchemaFields] = useState<AssociationSchemaField[]>(
    [],
  );
  const [selectedFormName, setSelectedFormName] = useState(
    field.props.associationFormName ?? "",
  );
  const appId =
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("appId") ?? "");
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);

  useEffect(() => {
    if (!isFormPickerOpen || !appId) return;
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

    if (scope === "cross") {
      void listApps({ responseStyle: "fields" })
        .then(({ data, error }) => {
          if (cancelled) return;
          setApps(
            !error && data?.code === 0 && data.data
              ? data.data.filter((app) => app.id !== appId)
              : [],
          );
        })
        .catch(() => {
          if (!cancelled) setApps([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [appId, field.id, isFormPickerOpen, scope]);

  useEffect(() => {
    const formId = field.props.associationFormId;
    let cancelled = false;
    if (!formId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setSchemaFields([]);
      });
    } else void getFormSchema({ path: { formUuid: formId }, responseStyle: "fields" })
      .then(({ data, error }) => {
        if (cancelled) return;
        const schema = data?.data?.schema as
          | { fields?: AssociationSchemaField[] }
          | undefined;
        setSchemaFields(!error && data?.code === 0 ? (schema?.fields ?? []) : []);
      })
      .catch(() => {
        if (!cancelled) setSchemaFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [field.props.associationFormId]);

  useEffect(() => {
    const formId = field.props.associationFormId;
    const selectedAppId = field.props.associationAppId ?? appId;
    if (!formId || !selectedAppId || field.props.associationFormName) return;

    let cancelled = false;
    void getAppForms(selectedAppId)
      .then((nextForms) => {
        const name = nextForms.find((form) => form.id === formId)?.name;
        if (!cancelled && name) setSelectedFormName(name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    appId,
    field.props.associationAppId,
    field.props.associationFormId,
    field.props.associationFormName,
  ]);

  function chooseForm(form: AssociationFormSummary, selectedAppId: string) {
    setSelectedFormName(form.name);
    update({
      associationFormId: form.id,
      associationFormName: form.name,
      associationAppId: selectedAppId,
      associationPrimaryFieldId: "",
      associationSecondaryFieldId: "",
      associationTableFieldIds: [],
      associationFilters: [],
      associationFiltersEnabled: false,
      associationFills: [],
      associationFillsEnabled: false,
      associationSorts: [],
      associationSortsEnabled: false,
    });
    setFormPickerOpen(false);
  }

  const formLabel =
    selectedFormName ||
    forms.find((form) => form.id === field.props.associationFormId)?.name ||
    "未选择";
  const sourceMainFields = schemaFields.filter(
    (item) =>
      !item.parentGroupId &&
      !["groupContainer", "subform", "description", "button"].includes(
        item.type,
      ),
  );
  const sourceSubforms = schemaFields.filter((item) => item.type === "subform");
  const currentParent = field.parentGroupId
    ? fields.find((item) => item.id === field.parentGroupId)
    : null;
  const currentSubformId =
    currentParent?.type === "subform" ? currentParent.id : null;
  const targetMainFields = fields.filter(
    (item) =>
      !item.parentGroupId &&
      !["groupContainer", "subform", "description", "button"].includes(
        item.type,
      ),
  );
  const targetSubforms = fields.filter((item) => item.type === "subform");
  return (
    <>
      <PropertyFold title="关联属性">
        <PropertyRow label="关联表单 *">
          <Button
            variant="ghost"
            onPress={() => setFormPickerOpen(true)}
            className="h-7 min-w-0 flex-1 justify-between border border-[var(--designer-border)] px-2 text-[11px]"
          >
            <span className="truncate">{formLabel}</span>
            <span>选择</span>
          </Button>
        </PropertyRow>
        <PropertyRow label="显示设置 *">
          <Button
            variant="ghost"
            isDisabled={!field.props.associationFormId}
            onPress={() => setDisplayOpen(true)}
            className="h-7 min-w-0 flex-1 justify-between border border-[var(--designer-border)] px-2 text-[11px]"
          >
            <span>
              {field.props.associationPrimaryFieldId ? "已配置" : "未配置"}
            </span>
            <span>设置</span>
          </Button>
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
      </PropertyFold>
      <Modal isOpen={isFormPickerOpen} onOpenChange={setFormPickerOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="theme-menu-surface w-[min(560px,92vw)] rounded-xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--designer-border)] px-5 py-4">
                <Modal.Heading>选择关联表单</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="px-5 py-4">
                <Tabs
                  variant="secondary"
                  selectedKey={scope}
                  onSelectionChange={(key) =>
                    setScope(key as "current" | "cross")
                  }
                >
                  <Tabs.List aria-label="关联表单范围">
                    <Tabs.Tab id="current" className="px-3 py-2 text-sm">
                      当前应用
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="cross" className="px-3 py-2 text-sm">
                      跨应用
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs>
                {scope === "current" ? (
                  <FormList
                    forms={forms}
                    onSelect={(form) => chooseForm(form, appId)}
                  />
                ) : (
                  <CrossAppFormList apps={apps} onSelect={chooseForm} />
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
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

function FormList({
  forms,
  onSelect,
}: {
  forms: AssociationFormSummary[];
  onSelect: (form: AssociationFormSummary) => void;
}) {
  return (
    <div className="space-y-1">
      {forms.length ? (
        forms.map((form) => (
          <Button
            key={form.id}
            variant="ghost"
            fullWidth
            onPress={() => onSelect(form)}
            className="justify-start px-3 text-left"
          >
            <span className="truncate">{form.name}</span>
          </Button>
        ))
      ) : (
        <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">
          暂无可关联表单
        </p>
      )}
    </div>
  );
}
function CrossAppFormList({
  apps,
  onSelect,
}: {
  apps: AssociationApp[];
  onSelect: (form: AssociationFormSummary, appId: string) => void;
}) {
  const [loaded, setLoaded] = useState<
    Record<string, AssociationFormSummary[]>
  >({});
  useEffect(() => {
    let cancelled = false;
    void mapWithConcurrency(apps, 6, async (app) => {
      try {
        return [app.id, await getAppForms(app.id)] as const;
      } catch {
        return [app.id, []] as const;
      }
    }).then((entries) => {
      if (!cancelled) setLoaded(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [apps]);
  return (
    <div className="space-y-4">
      {apps.map((app) => (
        <section key={app.id}>
          <h3 className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
            {app.name}
          </h3>
          <FormList
            forms={loaded[app.id] ?? []}
            onSelect={(form) => onSelect(form, app.id)}
          />
        </section>
      ))}
    </div>
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
  const [tab, setTab] = useState<"dropdown" | "table">("dropdown");
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="theme-menu-surface w-[min(960px,96vw)] rounded-xl shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--designer-border)] px-6 py-4">
              <Modal.Heading>显示设置</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="px-6 py-5">
              <Tabs
                variant="secondary"
                selectedKey={tab}
                onSelectionChange={(key) => setTab(key as "dropdown" | "table")}
              >
                <Tabs.List aria-label="关联表单显示设置">
                  <Tabs.Tab id="dropdown" className="px-4 py-2 text-sm">
                    下拉菜单显示字段
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="table" className="px-4 py-2 text-sm">
                    数据表展示字段
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs>
              {tab === "dropdown" ? (
                <div className="mt-5 grid gap-6 sm:grid-cols-2">
                  <div className="rounded-lg bg-[var(--designer-surface-soft)] p-5 text-sm">
                    <p className="font-medium">示例</p>
                    <p className="mt-8">
                      {fields.find((item) => item.id === primary)?.label ??
                        "主要信息"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {fields.find((item) => item.id === secondary)?.label ??
                        "次要信息"}
                    </p>
                  </div>
                  <div className="space-y-4">
                    <AssociationSelect
                      label="主要信息 *"
                      value={primary}
                      fields={fields}
                      onChange={setPrimary}
                    />
                    <AssociationSelect
                      label="次要信息"
                      value={secondary}
                      fields={fields}
                      onChange={setSecondary}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {fields.map((item) => (
                    <Checkbox
                      key={item.id}
                      isSelected={tableFields.includes(item.id)}
                      onChange={(selected) =>
                        setTableFields((current) =>
                          selected
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Checkbox.Content>{item.label}</Checkbox.Content>
                    </Checkbox>
                  ))}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2 border-t border-[var(--designer-border)] px-6 py-3">
              <Button variant="secondary" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                isDisabled={!primary}
                onPress={() => {
                  onSave({
                    associationPrimaryFieldId: primary,
                    associationSecondaryFieldId: secondary,
                    associationTableFieldIds: tableFields,
                  });
                  onOpenChange(false);
                }}
              >
                确定
              </Button>
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
    <label className="block text-xs text-[var(--color-text-secondary)]">
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
      <Switch
        aria-label="启用数据筛选"
        isSelected={enabled}
        onChange={onEnabledChange}
        className="shrink-0"
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
      {enabled ? (
        <Input
          aria-label="数据筛选配置"
          readOnly
          value={summary}
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 text-[11px]"
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
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="theme-menu-surface flex h-[min(640px,86vh)] w-[min(920px,96vw)] flex-col overflow-hidden rounded-xl shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--designer-border)] px-6 py-4">
              <Modal.Heading>数据筛选</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
                数据会按照如下条件进行筛选，前者为关联表单中的字段。
              </p>
              <div className="relative space-y-4 pl-11 before:absolute before:bottom-5 before:left-5 before:top-5 before:border-l before:border-[var(--designer-border)]">
                {rules.map((rule, index) => (
                  <div
                    key={`${index}-${rule.fieldId}`}
                    className="relative flex flex-wrap items-center gap-2"
                  >
                    <span className="absolute -left-11 top-1/2 flex h-7 w-10 -translate-y-1/2 items-center justify-center bg-[var(--color-bg-surface)] text-xs text-[var(--color-text-secondary)]">
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
                    <Input
                      aria-label="筛选值"
                      className="w-52"
                      placeholder="请输入匹配值"
                      value={rule.value}
                      onChange={(event) =>
                        updateRule(index, { value: event.currentTarget.value })
                      }
                    />
                    <Button
                      isIconOnly
                      aria-label="删除条件"
                      variant="ghost"
                      isDisabled={rules.length === 1}
                      onPress={() => removeRule(index)}
                      className="h-8 w-8 text-[var(--color-text-secondary)]"
                    >
                      删除
                    </Button>
                    <Button
                      isIconOnly
                      aria-label="添加条件"
                      variant="ghost"
                      onPress={addRule}
                      className="h-8 w-8 text-[var(--color-primary)]"
                    >
                      +
                    </Button>
                  </div>
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2 border-t border-[var(--designer-border)] px-6 py-3">
              <Button variant="secondary" onPress={() => onChange(false)}>
                取消
              </Button>
              <Button
                isDisabled={!canSave}
                onPress={() => {
                  onSave(rules);
                  onChange(false);
                }}
              >
                确定
              </Button>
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
  const selected = fields.find((field) => field.id === value);
  return (
    <Select
      aria-label={ariaLabel}
      className={className}
      selectedKey={value || null}
      onSelectionChange={(key: Key | null) =>
        onChange(key === null ? "" : String(key))
      }
    >
      <Select.Trigger className="h-9 min-h-9 rounded-md border-[var(--designer-border)] bg-[var(--color-bg-input)] px-2 text-sm">
        <Select.Value>{selected?.label ?? placeholder}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {allowEmpty ? <ListBox.Item id="" textValue={placeholder}>{placeholder}</ListBox.Item> : null}
          {fields.map((item) => (
            <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
              {item.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
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
  onChange: (rules: Array<{ fieldId: string; direction: "asc" | "desc" }>) => void;
  onEnabledChange: (enabled: boolean) => void;
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  const [fieldId, setFieldId] = useState("");
  const [value, setValue] = useState("");
  return (
    <PropertyRow label="数据排序">
      <Switch
        aria-label="启用数据排序"
        isSelected={enabled}
        onChange={onEnabledChange}
        className="shrink-0"
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
      {enabled ? (
        <Input
          aria-label="数据排序配置"
          readOnly
          value={summary}
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 text-[11px]"
        />
      ) : null}
      <Modal isOpen={open} onOpenChange={setOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="theme-menu-surface w-[min(440px,92vw)] rounded-xl">
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
                <Button
                  isDisabled={!fieldId}
                  onPress={() => {
                    onChange([{ fieldId, direction: (value || "asc") as "asc" | "desc" }]);
                    setOpen(false);
                  }}
                >
                  确定
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </PropertyRow>
  );
}

type AssociationFill = NonNullable<
  DesignerFieldProps["associationFills"]
>[number];

function AssociationFillControl({
  currentSubformId,
  enabled,
  onChange,
  onEnabledChange,
  rules,
  sourceFields,
  sourceSchemaFields,
  sourceSubforms,
  subformRules,
  summary,
  targetFields,
  targetMainFields,
  targetSubforms,
}: {
  currentSubformId: string | null;
  enabled: boolean;
  onChange: (
    rules: AssociationFill[],
    subformRules: NonNullable<DesignerFieldProps["associationSubformFills"]>,
  ) => void;
  onEnabledChange: (enabled: boolean) => void;
  rules: AssociationFill[];
  sourceFields: AssociationSchemaField[];
  sourceSchemaFields: AssociationSchemaField[];
  sourceSubforms: AssociationSchemaField[];
  subformRules: NonNullable<DesignerFieldProps["associationSubformFills"]>;
  summary: string;
  targetFields: PlacedField[];
  targetMainFields: PlacedField[];
  targetSubforms: PlacedField[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <PropertyRow label="数据填充">
      <Switch
        aria-label="启用数据填充"
        isSelected={enabled}
        onChange={onEnabledChange}
        className="shrink-0"
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
      {enabled ? (
        <Input
          aria-label="数据填充配置"
          readOnly
          value={summary}
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 text-[11px]"
        />
      ) : null}
      <AssociationFillModalV2
        key={`${open}:${JSON.stringify(rules)}:${JSON.stringify(subformRules)}`}
        currentSubformId={currentSubformId}
        fields={sourceFields}
        isOpen={open}
        onChange={setOpen}
        onSave={onChange}
        rules={rules}
        sourceSchemaFields={sourceSchemaFields}
        sourceSubforms={sourceSubforms}
        subformRules={subformRules}
        targetFields={targetFields}
        targetMainFields={targetMainFields}
        targetSubforms={targetSubforms}
      />
    </PropertyRow>
  );
}

function AssociationFillModalV2({
  currentSubformId,
  fields,
  isOpen,
  onChange,
  onSave,
  rules,
  sourceSchemaFields,
  sourceSubforms,
  subformRules,
  targetFields: allTargetFields,
  targetMainFields,
  targetSubforms,
}: {
  currentSubformId: string | null;
  fields: AssociationSchemaField[];
  isOpen: boolean;
  onChange: (open: boolean) => void;
  onSave: (
    rules: AssociationFill[],
    subformRules: NonNullable<DesignerFieldProps["associationSubformFills"]>,
  ) => void;
  rules: AssociationFill[];
  sourceSchemaFields: AssociationSchemaField[];
  sourceSubforms: AssociationSchemaField[];
  subformRules: NonNullable<DesignerFieldProps["associationSubformFills"]>;
  targetFields: PlacedField[];
  targetMainFields: PlacedField[];
  targetSubforms: PlacedField[];
}) {
  const [mainRules, setMainRules] = useState<AssociationFill[]>(() => rules);
  const [childRules, setChildRules] = useState(() => subformRules);
  const currentTargetFields = currentSubformId
    ? allTargetFields.filter((item) => item.parentGroupId === currentSubformId)
    : targetMainFields;
  const options = currentTargetFields.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.type,
  }));
  const updateMain = (index: number, patch: Partial<AssociationFill>) =>
    setMainRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  const addMain = () =>
    setMainRules((current) => [
      ...current,
      { sourceFieldId: "", targetFieldId: "" },
    ]);
  const removeMain = (index: number) =>
    setMainRules((current) =>
      current.length === 1
        ? current
        : current.filter((_, ruleIndex) => ruleIndex !== index),
    );
  const addChildRule = () =>
    setChildRules((current) => [
      ...current,
      {
        sourceSubformId: sourceSubforms[0]?.id ?? "",
        targetSubformId: targetSubforms[0]?.id ?? "",
        mappings: [{ sourceFieldId: "", targetFieldId: "" }],
      },
    ]);
  const updateChildRule = (
    index: number,
    patch: Partial<
      NonNullable<DesignerFieldProps["associationSubformFills"]>[number]
    >,
  ) =>
    setChildRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  const canSave =
    mainRules.every((rule) => rule.sourceFieldId && rule.targetFieldId) &&
    childRules.every(
      (rule) =>
        rule.sourceSubformId &&
        rule.targetSubformId &&
        rule.mappings.every(
          (mapping) => mapping.sourceFieldId && mapping.targetFieldId,
        ),
    );
  return (
    <Modal isOpen={isOpen} onOpenChange={onChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog className="theme-menu-surface flex h-[min(720px,90vh)] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-xl shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--designer-border)] px-6 py-4">
              <Modal.Heading>数据填充</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
                {currentSubformId
                  ? "当前关联组件位于子表中，仅能填充该子表字段。"
                  : "主表字段填充主表字段；子表规则会按源子表行生成当前表单子表行。"}
              </p>
              <FillRuleSection
                title={currentSubformId ? "当前子表填充规则" : "主表填充规则"}
                sourceFields={fields}
                rules={mainRules}
                targetFields={options}
                onAdd={addMain}
                onRemove={removeMain}
                onChange={updateMain}
              />
              {!currentSubformId &&
              sourceSubforms.length > 0 &&
              targetSubforms.length > 0 ? (
                <section className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium">子表填充规则</h3>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={addChildRule}
                    >
                      新增子表规则
                    </Button>
                  </div>
                  {childRules.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--designer-border)] px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                      未配置子表填充规则
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {childRules.map((rule, index) => {
                        const sourceFields = sourceSchemaFields.filter(
                          (item) =>
                            item.parentGroupId === rule.sourceSubformId &&
                            ![
                              "groupContainer",
                              "subform",
                              "description",
                              "button",
                            ].includes(item.type),
                        );
                        const targetChildFields = targetFieldsForSubform(
                          rule.targetSubformId,
                          allTargetFields,
                        );
                        return (
                          <div
                            key={`${rule.sourceSubformId}-${rule.targetSubformId}-${index}`}
                            className="rounded-lg border border-[var(--designer-border)] p-4"
                          >
                            <div className="grid gap-3 md:grid-cols-2">
                              <AssociationInlineSelect
                                ariaLabel="关联表单子表"
                                className="w-full"
                                fields={sourceSubforms}
                                value={rule.sourceSubformId}
                                onChange={(sourceSubformId) =>
                                  updateChildRule(index, {
                                    sourceSubformId,
                                    mappings: [
                                      { sourceFieldId: "", targetFieldId: "" },
                                    ],
                                  })
                                }
                              />
                              <AssociationInlineSelect
                                ariaLabel="当前表单子表"
                                className="w-full"
                                fields={targetSubforms.map((item) => ({
                                  id: item.id,
                                  label: item.label,
                                  type: item.type,
                                }))}
                                value={rule.targetSubformId}
                                onChange={(targetSubformId) =>
                                  updateChildRule(index, {
                                    targetSubformId,
                                    mappings: [
                                      { sourceFieldId: "", targetFieldId: "" },
                                    ],
                                  })
                                }
                              />
                            </div>
                            <FillRuleSection
                              title="字段映射"
                              sourceFields={sourceFields}
                              rules={rule.mappings}
                                targetFields={targetChildFields}
                              onAdd={() =>
                                updateChildRule(index, {
                                  mappings: [
                                    ...rule.mappings,
                                    { sourceFieldId: "", targetFieldId: "" },
                                  ],
                                })
                              }
                              onRemove={(mappingIndex) =>
                                updateChildRule(index, {
                                  mappings:
                                    rule.mappings.length === 1
                                      ? rule.mappings
                                      : rule.mappings.filter(
                                          (_, itemIndex) =>
                                            itemIndex !== mappingIndex,
                                        ),
                                })
                              }
                              onChange={(mappingIndex, patch) =>
                                updateChildRule(index, {
                                  mappings: rule.mappings.map(
                                    (mapping, itemIndex) =>
                                      itemIndex === mappingIndex
                                        ? { ...mapping, ...patch }
                                        : mapping,
                                  ),
                                })
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2 border-t border-[var(--designer-border)] px-6 py-3">
              <Button variant="secondary" onPress={() => onChange(false)}>
                取消
              </Button>
              <Button
                isDisabled={!canSave}
                onPress={() => {
                  onSave(mainRules, childRules);
                  onChange(false);
                }}
              >
                确定
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function targetFieldsForSubform(subformId: string, fields: PlacedField[]) {
  return fields
    .filter((field) => field.parentGroupId === subformId)
    .map((field) => ({ id: field.id, label: field.label, type: field.type }));
}

function FillRuleSection({
  onAdd,
  onChange,
  onRemove,
  rules,
  sourceFields,
  targetFields,
  title,
}: {
  onAdd: () => void;
  onChange: (index: number, patch: Partial<AssociationFill>) => void;
  onRemove: (index: number) => void;
  rules: AssociationFill[];
  sourceFields: AssociationSchemaField[];
  targetFields: AssociationSchemaField[];
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--designer-border)]">
      <header className="flex items-center justify-between border-b border-[var(--designer-border)] bg-[var(--designer-surface-soft)] px-4 py-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button size="sm" variant="ghost" onPress={onAdd}>
          新增字段映射
        </Button>
      </header>
      <div className="space-y-3 p-4">
        {rules.map((rule, index) => (
          <div
            key={`${index}-${rule.sourceFieldId}-${rule.targetFieldId}`}
            className="grid grid-cols-[minmax(180px,1fr)_100px_minmax(180px,1fr)_40px] items-center gap-3"
          >
            <AssociationInlineSelect
              ariaLabel="关联字段"
              className="w-full"
              fields={sourceFields}
              value={rule.sourceFieldId}
              onChange={(sourceFieldId) => onChange(index, { sourceFieldId })}
            />
            <span className="text-center text-sm text-[var(--color-text-secondary)]">
              填充到
            </span>
            <AssociationInlineSelect
              ariaLabel="当前字段"
              className="w-full"
              fields={targetFields}
              value={rule.targetFieldId}
              onChange={(targetFieldId) => onChange(index, { targetFieldId })}
            />
            <Button
              isIconOnly
              aria-label="删除映射"
              variant="ghost"
              isDisabled={rules.length === 1}
              onPress={() => onRemove(index)}
            >
              删除
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

type IdentityUser = {
  id: string;
  displayName: string;
  jobNumber: string | null;
  sourceType: string;
  status: string;
};
type IdentityRole = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
};
const MEMBER_SOURCES = [
  { value: "local", label: "本地" },
  { value: "dingtalk", label: "钉钉" },
  { value: "wecom", label: "企业微信" },
  { value: "feishu", label: "飞书" },
] as const;

function MemberProperties({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [isSelectorOpen, setSelectorOpen] = useState(false);
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [roles, setRoles] = useState<IdentityRole[]>([]);
  const [loading, setLoading] = useState(false);
  const source = field.props.memberOrganizationSource ?? "local";
  const scope = field.props.memberSelectableScope ?? "all";
  const format = field.props.memberDisplayFormat ?? "name";
  const selectedIds =
    scope === "roles"
      ? (field.props.memberRoleIds ?? [])
      : (field.props.memberUserIds ?? []);

  useEffect(() => {
    if (!isSelectorOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      Promise.all([
        listUsers({ responseStyle: "fields" }),
        listRoles({ responseStyle: "fields" }),
      ])
        .then(([userResponse, roleResponse]) => {
          if (cancelled) return;
          setUsers(
            !userResponse.error &&
              userResponse.data?.code === 0 &&
              userResponse.data.data
              ? userResponse.data.data.map((user) => ({
                  id: user.id,
                  displayName: user.displayName,
                  jobNumber: user.jobNumber ?? null,
                  sourceType: user.sourceType,
                  status: user.status,
                }))
              : [],
          );
          setRoles(
            !roleResponse.error &&
              roleResponse.data?.code === 0 &&
              roleResponse.data.data
              ? roleResponse.data.data
              : [],
          );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isSelectorOpen]);

  const candidates = useMemo(() => {
    const matchesSource = (item: { sourceType: string }) =>
      item.sourceType === source;
    return scope === "roles"
      ? roles.filter((role) => matchesSource(role) && role.status === "active")
      : users.filter((user) => matchesSource(user) && user.status === "active");
  }, [roles, scope, source, users]);

  function updateSelected(id: string, selected: boolean) {
    const next = selected
      ? [...selectedIds, id]
      : selectedIds.filter((item) => item !== id);
    onPropsChange(
      field.id,
      scope === "roles" ? { memberRoleIds: next } : { memberUserIds: next },
    );
  }

  return (
    <>
      <PropertyRow label="组织来源">
        <MemberPropertySelect
          ariaLabel="组织来源"
          value={source}
          options={MEMBER_SOURCES}
          onChange={(value) =>
            onPropsChange(field.id, {
              memberOrganizationSource:
                value as DesignerFieldProps["memberOrganizationSource"],
              memberRoleIds: [],
              memberUserIds: [],
            })
          }
        />
      </PropertyRow>
      <PropertyRow label="可选范围">
        <MemberPropertySelect
          ariaLabel="可选范围"
          value={scope}
          options={[
            { value: "all", label: "全部成员" },
            { value: "roles", label: "指定角色" },
            { value: "members", label: "指定成员" },
          ]}
          onChange={(value) =>
            onPropsChange(field.id, {
              memberSelectableScope:
                value as DesignerFieldProps["memberSelectableScope"],
            })
          }
        />
      </PropertyRow>
      {scope !== "all" ? (
        <PropertyRow label="范围设置">
          <Button
            variant="ghost"
            onPress={() => setSelectorOpen(true)}
            className="h-7 min-w-0 flex-1 justify-between border border-[var(--designer-border)] px-2 text-[11px]"
          >
            <span>{scope === "roles" ? "设置角色" : "设置成员"}</span>
            <span className="text-[10px] text-[var(--color-text-secondary)]">
              已选 {selectedIds.length}
            </span>
          </Button>
        </PropertyRow>
      ) : null}
      <PropertyRow label="成员格式">
        <MemberPropertySelect
          ariaLabel="成员格式"
          value={format}
          options={[
            { value: "name", label: "姓名" },
            { value: "nameJobNumber", label: "姓名(工号)" },
            { value: "nameUserId", label: "姓名(userId)" },
          ]}
          onChange={(value) =>
            onPropsChange(field.id, {
              memberDisplayFormat:
                value as DesignerFieldProps["memberDisplayFormat"],
            })
          }
        />
      </PropertyRow>
      <PropertyRow label="允许多选">
        <Switch
          aria-label="允许多选"
          isSelected={Boolean(field.props.memberMultiple)}
          onChange={(memberMultiple) =>
            onPropsChange(field.id, { memberMultiple })
          }
          className="justify-end"
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </PropertyRow>
      <Modal isOpen={isSelectorOpen} onOpenChange={setSelectorOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" scroll="inside" size="sm">
            <Modal.Dialog className="theme-menu-surface flex max-h-[72vh] w-[min(520px,92vw)] flex-col overflow-hidden rounded-xl shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--designer-border)] px-5 py-4">
                <Modal.Heading className="text-base font-semibold">
                  选择{scope === "roles" ? "角色" : "成员"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
                  来源：
                  {MEMBER_SOURCES.find((item) => item.value === source)?.label}{" "}
                  · 可多选
                </p>
                {loading ? (
                  <div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
                    正在加载数据…
                  </div>
                ) : null}
                {!loading && candidates.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
                    该组织来源暂无可选{scope === "roles" ? "角色" : "成员"}。
                  </div>
                ) : null}
                <div className="space-y-1">
                  {candidates.map((candidate) => {
                    const id = candidate.id;
                    const label =
                      scope === "roles"
                        ? (candidate as IdentityRole).name
                        : (candidate as IdentityUser).displayName;
                    const detail =
                      scope === "roles"
                        ? id
                        : (candidate as IdentityUser).jobNumber || id;
                    return (
                      <Checkbox
                        key={id}
                        isSelected={selectedIds.includes(id)}
                        onChange={(selected) => updateSelected(id, selected)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--designer-surface-soft)]"
                      >
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <Checkbox.Content className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {label}
                          </span>
                        </Checkbox.Content>
                        <span className="max-w-36 truncate text-[10px] text-[var(--color-text-secondary)]">
                          {detail}
                        </span>
                      </Checkbox>
                    );
                  })}
                </div>
              </Modal.Body>
              <Modal.Footer className="flex justify-end border-t border-[var(--designer-border)] px-5 py-3">
                <Button onPress={() => setSelectorOpen(false)}>完成</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}

function MemberPropertySelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  value: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      aria-label={ariaLabel}
      className="min-w-0 flex-1 text-[11px]"
      selectedKey={value}
      onSelectionChange={(key: Key | null) =>
        onChange(key === null ? "" : String(key))
      }
    >
      <Select.Trigger className="h-7 min-h-7 rounded-md border-[var(--designer-border)] bg-[var(--designer-surface-solid)] px-2">
        <Select.Value>{selected?.label ?? "请选择"}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
            >
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function SubformProperties({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);
  return (
    <>
      <PropertyFold title="子表全局配置">
        <PropertyRow label="按钮名称">
          <TextWithActions
            value={field.props.subformAddButtonText ?? "新增一项"}
            onChange={(value) => update({ subformAddButtonText: value })}
          />
        </PropertyRow>
        <PropertyRow label="按钮状态">
          <PropertySegmented
            value={field.props.subformButtonState ?? "normal"}
            options={[
              { label: "普通", value: "normal" },
              { label: "禁用", value: "disabled" },
              { label: "隐藏", value: "hidden" },
            ]}
            onChange={(value) =>
              update({
                subformButtonState: value as "normal" | "disabled" | "hidden",
              })
            }
          />
        </PropertyRow>
        <PropertyRow label="批量导入">
          <PanelSwitch
            isSelected={Boolean(field.props.subformAllowBatchImport)}
            onChange={(value) => update({ subformAllowBatchImport: value })}
          />
        </PropertyRow>
        <PropertyRow label="导出 Excel">
          <PanelSwitch
            isSelected={Boolean(field.props.subformAllowExcelExport)}
            onChange={(value) => update({ subformAllowExcelExport: value })}
          />
        </PropertyRow>
        <PropertyRow label="批量删除">
          <PanelSwitch
            isSelected={Boolean(field.props.subformAllowBatchDelete)}
            onChange={(value) => update({ subformAllowBatchDelete: value })}
          />
        </PropertyRow>
        <PropertyRow label="过滤空行">
          <PanelSwitch
            isSelected={field.props.subformFilterEmptyRows !== false}
            onChange={(value) => update({ subformFilterEmptyRows: value })}
          />
        </PropertyRow>
      </PropertyFold>
      <PropertyFold title="操作项配置">
        <PropertyRow label="复制按钮">
          <PanelSwitch
            isSelected={Boolean(field.props.subformShowCopyButton)}
            onChange={(value) => update({ subformShowCopyButton: value })}
          />
        </PropertyRow>
        <PropertyRow label="删除按钮">
          <PanelSwitch
            isSelected={field.props.subformShowDeleteButton !== false}
            onChange={(value) => update({ subformShowDeleteButton: value })}
          />
        </PropertyRow>
        <PropertyRow label="按钮名称">
          <TextWithActions
            value={field.props.subformDeleteButtonText ?? "删除"}
            onChange={(value) => update({ subformDeleteButtonText: value })}
          />
        </PropertyRow>
        <PropertyRow label="删除确认">
          <PanelSwitch
            isSelected={field.props.subformConfirmDelete !== false}
            onChange={(value) => update({ subformConfirmDelete: value })}
          />
        </PropertyRow>
        <PropertyRow label="显示排序">
          <PanelSwitch
            isSelected={Boolean(field.props.subformShowSort)}
            onChange={(value) => update({ subformShowSort: value })}
          />
        </PropertyRow>
      </PropertyFold>
      <PropertyFold title="展示样式">
        <PropertyRow label="设备">
          <PropertySegmented
            value={field.props.subformDisplayMode ?? "desktop"}
            options={[
              { label: "电脑端", value: "desktop" },
              { label: "移动端", value: "mobile" },
            ]}
            onChange={(value) =>
              update({ subformDisplayMode: value as "desktop" | "mobile" })
            }
          />
        </PropertyRow>
        <PropertyRow label="排列方式">
          <PropertySegmented
            value={field.props.subformArrangement ?? "table"}
            options={[
              { label: "平铺方式", value: "tile" },
              { label: "表格方式", value: "table" },
            ]}
            onChange={(value) =>
              update({ subformArrangement: value as "tile" | "table" })
            }
          />
        </PropertyRow>
        <PropertyRow label="主题">
          <PropertySegmented
            value={field.props.subformTheme ?? "divider"}
            options={[
              { label: "斑马纹", value: "zebra" },
              { label: "分割线", value: "divider" },
              { label: "边框线", value: "border" },
            ]}
            onChange={(value) =>
              update({ subformTheme: value as "zebra" | "divider" | "border" })
            }
          />
        </PropertyRow>
        <PropertyRow label="显示表头">
          <PanelSwitch
            isSelected={field.props.subformShowHeader !== false}
            onChange={(value) => update({ subformShowHeader: value })}
          />
        </PropertyRow>
        <PropertyRow label="显示序号">
          <PanelSwitch
            isSelected={field.props.subformShowIndex !== false}
            onChange={(value) => update({ subformShowIndex: value })}
          />
        </PropertyRow>
        <PropertyRow label="布局算法">
          <PropertySegmented
            value={field.props.subformLayoutMode ?? "fixed"}
            options={[
              { label: "自动", value: "auto" },
              { label: "固定", value: "fixed" },
            ]}
            onChange={(value) =>
              update({ subformLayoutMode: value as "auto" | "fixed" })
            }
          />
        </PropertyRow>
        <PropertyRow label="分页条数">
          <NumberWithActions
            min={1}
            value={field.props.subformPageSize}
            onChange={(value) =>
              update({ subformPageSize: Math.max(1, value ?? 20) })
            }
          />
        </PropertyRow>
        <PropertyRow label="最大条数">
          <NumberWithActions
            min={1}
            value={field.props.subformMaxRows}
            onChange={(value) =>
              update({ subformMaxRows: Math.max(1, value ?? 500) })
            }
          />
        </PropertyRow>
        <PropertyRow label="左侧列冻结">
          <NumberWithActions
            min={0}
            value={field.props.subformFrozenLeftColumns}
            onChange={(value) =>
              update({ subformFrozenLeftColumns: Math.max(0, value ?? 0) })
            }
          />
        </PropertyRow>
        <PropertyRow label="操作列宽">
          <NumberWithActions
            min={40}
            value={field.props.subformActionColumnWidth}
            onChange={(value) =>
              update({ subformActionColumnWidth: Math.max(40, value ?? 70) })
            }
          />
        </PropertyRow>
        <PropertyRow label="自定义其它列">
          <PanelSwitch
            isSelected={Boolean(field.props.subformAllowCustomColumns)}
            onChange={(value) => update({ subformAllowCustomColumns: value })}
          />
        </PropertyRow>
      </PropertyFold>
      <PropertyFold title="合计设置">
        <PropertyRow label="启用合计">
          <PanelSwitch
            isSelected={Boolean(field.props.subformEnableTotals)}
            onChange={(value) => update({ subformEnableTotals: value })}
          />
        </PropertyRow>
      </PropertyFold>
    </>
  );
}

function SerialNumberProperties({
  field,
  fields,
  onPropsChange,
}: {
  field: PlacedField;
  fields: PlacedField[];
  onPropsChange: FieldPropsChangeHandler;
}) {
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const rules = getSerialNumberRules(field.props);
  const editingRule = rules.find((rule) => rule.id === editingRuleId) ?? null;
  const selectableFields = fields.filter((candidate) => candidate.id !== field.id && candidate.type !== "groupContainer" && candidate.type !== "subform" && candidate.type !== "description" && candidate.type !== "button");
  const preview = rules.map((rule) => serialRulePreview(rule, selectableFields)).join("");

  const updateRule = (ruleId: string, nextRule: SerialNumberRule) => {
    update({ serialNumberRules: rules.map((rule) => rule.id === ruleId ? nextRule : rule) });
  };

  const moveRule = (activeRuleId: string, targetRuleId: string) => {
    if (activeRuleId === targetRuleId) return;
    const sourceIndex = rules.findIndex((rule) => rule.id === activeRuleId);
    const targetIndex = rules.findIndex((rule) => rule.id === targetRuleId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextRules = [...rules];
    const [moved] = nextRules.splice(sourceIndex, 1);
    nextRules.splice(targetIndex, 0, moved);
    update({ serialNumberRules: nextRules });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (event: DragEndEvent) => {
    const targetRuleId = event.over?.id;
    if (targetRuleId) moveRule(String(event.active.id), String(targetRuleId));
  };

  return (
    <>
      <PropertyFold title="规则定义">
        <div className="space-y-1.5">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            {rules.map((rule) => <SerialNumberRuleItem key={rule.id} rule={rule} fields={selectableFields} onDelete={() => update({ serialNumberRules: rules.filter((item) => item.id !== rule.id) })} onEdit={() => setEditingRuleId(rule.id)} />)}
          </DndContext>
          <SerialNumberAddRulePopover fields={selectableFields} onAdd={(rule) => update({ serialNumberRules: [...rules, rule] })} />
        </div>
      </PropertyFold>
      <PropertyFold title="流水号效果预览">
        <div className="rounded-md bg-[var(--color-primary-soft)] px-3 py-2 text-center font-mono text-sm text-[var(--color-text-primary)]">
          {preview}
        </div>
      </PropertyFold>
      <Modal isOpen={Boolean(editingRule)} onOpenChange={(open) => !open && setEditingRuleId(null)}>
        <Modal.Backdrop className="designer-modal-backdrop"><Modal.Container placement="center" size="sm"><Modal.Dialog className="bg-[var(--designer-surface-solid)]"><Modal.Header><Modal.Heading>编辑规则</Modal.Heading></Modal.Header><Modal.Body>
          {editingRule?.type === "fixedText" ? <Input aria-label="固定字符内容" value={editingRule.value} onChange={(event) => updateRule(editingRule.id, { ...editingRule, value: event.currentTarget.value })} /> : null}
          {editingRule?.type === "submittedDate" ? <PropertySegmented value={editingRule.format} options={[{ label: "年", value: "year" }, { label: "年月", value: "yearMonth" }, { label: "年月日", value: "yearMonthDay" }, { label: "年月日时分", value: "yearMonthDayHourMinute" }, { label: "年月日时分秒", value: "yearMonthDayHourMinuteSecond" }]} onChange={(value) => updateRule(editingRule.id, { ...editingRule, format: value as typeof editingRule.format })} /> : null}
          {editingRule?.type === "formField" ? <div className="space-y-2"><select aria-label="表单字段" value={editingRule.fieldId} onChange={(event) => updateRule(editingRule.id, { ...editingRule, fieldId: event.currentTarget.value })} className="h-9 w-full rounded-md border border-[var(--designer-border)] bg-[var(--designer-surface-solid)] px-2 text-sm"><option value="">请选择字段</option>{selectableFields.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select><Input aria-label="空值替代" placeholder="请输入（最多10个字符）" maxLength={10} value={editingRule.fallback} onChange={(event) => updateRule(editingRule.id, { ...editingRule, fallback: event.currentTarget.value })} /></div> : null}
          {editingRule?.type === "autoCount" ? <div className="space-y-2"><PropertyRow label="计数位数"><NumberWithActions min={1} value={editingRule.digits} onChange={(value) => updateRule(editingRule.id, { ...editingRule, digits: Math.max(1, value ?? 4) })} /></PropertyRow><PropertyRow label="固定补零"><PanelSwitch isSelected={editingRule.fixedDigits} onChange={(value) => updateRule(editingRule.id, { ...editingRule, fixedDigits: value })} /></PropertyRow><PropertyRow label="重置周期"><PropertySegmented value={editingRule.resetPeriod} options={[{ label: "不自动重置", value: "never" }, { label: "每天", value: "daily" }, { label: "每月", value: "monthly" }, { label: "每年", value: "yearly" }]} onChange={(value) => updateRule(editingRule.id, { ...editingRule, resetPeriod: value as typeof editingRule.resetPeriod })} /></PropertyRow><PropertyRow label="初始值"><NumberWithActions min={1} value={editingRule.initialValue} onChange={(value) => updateRule(editingRule.id, { ...editingRule, initialValue: Math.max(1, value ?? 1) })} /></PropertyRow></div> : null}
        </Modal.Body><Modal.Footer><Button onPress={() => setEditingRuleId(null)}>完成</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>
    </>
  );
}

function getSerialNumberRules(props: DesignerFieldProps): SerialNumberRule[] {
  if (props.serialNumberRules?.length) return props.serialNumberRules;
  return [{ id: "auto-count", type: "autoCount", digits: Math.max(1, props.serialNumberDigits ?? 4), fixedDigits: props.serialNumberFixedDigits !== false, resetPeriod: props.serialNumberResetPeriod ?? "never", initialValue: Math.max(1, props.serialNumberInitialValue ?? 1) }];
}

function SerialNumberRuleItem({ rule, fields, onDelete, onEdit }: { rule: SerialNumberRule; fields: PlacedField[]; onDelete: () => void; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef: setDraggableRef, transform, isDragging } = useDraggable({ id: rule.id });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: rule.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return <div ref={(node) => { setDraggableRef(node); setDroppableRef(node); }} style={style} className={`flex min-w-0 items-center gap-1 rounded-md border px-2 py-1.5 ${isDragging ? "opacity-40" : ""} ${isOver ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : "border-[var(--designer-border)] bg-[var(--designer-surface-solid)]"}`}>
    <button type="button" aria-label="拖拽排序" className="cursor-grab touch-none text-[13px] text-[var(--color-text-disabled)] active:cursor-grabbing" {...attributes} {...listeners}>⋮⋮</button>
    <span className="min-w-0 flex-1 truncate text-[11px]">{serialRuleLabel(rule, fields)}</span>
    <button type="button" aria-label="编辑规则" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-primary)]" onClick={onEdit}>✎</button>
    {rule.type !== "autoCount" ? <button type="button" aria-label="删除规则" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-danger)]" onClick={onDelete}>×</button> : null}
  </div>;
}

function SerialNumberAddRulePopover({ fields, onAdd }: { fields: PlacedField[]; onAdd: (rule: SerialNumberRule) => void }) {
  const [isOpen, setOpen] = useState(false);
  const [ruleCounter, setRuleCounter] = useState(1);
  const [type, setType] = useState<"fixedText" | "submittedDate" | "formField">("fixedText");
  const [value, setValue] = useState("TEXT");
  const [format, setFormat] = useState<Extract<SerialNumberRule, { type: "submittedDate" }>["format"]>("yearMonthDay");
  const [fieldId, setFieldId] = useState("");
  const [fallback, setFallback] = useState("");
  const confirmAdd = () => {
    const id = `serial-rule-${type}-${ruleCounter}`;
    onAdd(type === "fixedText" ? { id, type, value } : type === "submittedDate" ? { id, type, format } : { id, type, fieldId, fallback });
    setRuleCounter((current) => current + 1);
    setOpen(false);
  };
  return <Popover isOpen={isOpen} onOpenChange={setOpen}>
    <Popover.Trigger><Button size="sm" variant="secondary">添加规则</Button></Popover.Trigger>
    <Popover.Content className="w-72 border border-[var(--designer-border)] bg-[var(--designer-surface-solid)] p-0">
      <Popover.Dialog className="space-y-3 p-3">
        <Popover.Heading className="text-sm font-medium">添加规则</Popover.Heading>
        <PropertySegmented value={type} options={[{ label: "固定字符", value: "fixedText" }, { label: "提交日期", value: "submittedDate" }, { label: "表单字段", value: "formField" }]} onChange={(next) => setType(next as typeof type)} />
        {type === "fixedText" ? <Input aria-label="固定字符" value={value} onChange={(event) => setValue(event.currentTarget.value)} /> : null}
        {type === "submittedDate" ? <PropertySegmented value={format} options={[{ label: "年", value: "year" }, { label: "年月", value: "yearMonth" }, { label: "年月日", value: "yearMonthDay" }, { label: "年月日时分", value: "yearMonthDayHourMinute" }, { label: "年月日时分秒", value: "yearMonthDayHourMinuteSecond" }]} onChange={(next) => setFormat(next as typeof format)} /> : null}
        {type === "formField" ? <div className="space-y-2"><Select aria-label="表单字段" selectedKey={fieldId || null} onSelectionChange={(key: Key | null) => setFieldId(key ? String(key) : "")}><Select.Trigger className="h-9 w-full rounded-md border-[var(--designer-border)]"><Select.Value>{fields.find((field) => field.id === fieldId)?.label ?? "请选择字段"}</Select.Value><Select.Indicator /></Select.Trigger><Select.Popover><ListBox>{fields.map((field) => <ListBox.Item key={field.id} id={field.id} textValue={field.label}>{field.label}</ListBox.Item>)}</ListBox></Select.Popover></Select><Input aria-label="空值替代" placeholder="请输入（最多10个字符）" maxLength={10} value={fallback} onChange={(event) => setFallback(event.currentTarget.value)} /></div> : null}
        <div className="flex justify-end"><Button size="sm" onPress={confirmAdd}>确认添加</Button></div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}

function serialRuleLabel(rule: SerialNumberRule, fields: PlacedField[]) {
  if (rule.type === "autoCount") return `自动计数  ${rule.digits} 位数`;
  if (rule.type === "fixedText") return `固定字符  ${rule.value || "未设置"}`;
  if (rule.type === "submittedDate") return `提交日期  ${serialRulePreview(rule, fields)}`;
  return `表单字段  ${fields.find((field) => field.id === rule.fieldId)?.label ?? "未选择"}`;
}

function serialRulePreview(rule: SerialNumberRule, fields: PlacedField[]) {
  if (rule.type === "autoCount") return rule.fixedDigits ? String(rule.initialValue).padStart(rule.digits, "0") : String(rule.initialValue);
  if (rule.type === "fixedText") return rule.value;
  if (rule.type === "formField") return `{${fields.find((field) => field.id === rule.fieldId)?.label ?? "字段"}}` || rule.fallback;
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  if (rule.format === "year") return String(now.getFullYear());
  if (rule.format === "yearMonth") return date.slice(0, 6);
  if (rule.format === "yearMonthDay") return date;
  if (rule.format === "yearMonthDayHourMinute") return `${date}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}

function PropertySegmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex h-7 min-w-0 flex-1 rounded-md bg-[var(--color-bg-subtle)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`min-w-0 flex-1 truncate rounded-sm px-1 text-[10px] ${value === option.value ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatusSegmented({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: (fieldId: string, props: DesignerFieldProps) => void;
}) {
  const current = field.props.isHidden
    ? "hidden"
    : field.props.isDisabled
      ? "disabled"
      : field.props.isReadOnly
        ? "readOnly"
        : "normal";
  const options = [
    { label: "普通", value: "normal" },
    { label: "禁用", value: "disabled" },
    { label: "只读", value: "readOnly" },
    { label: "隐藏", value: "hidden" },
  ];

  return (
    <div className="flex h-7 flex-1 rounded-md bg-[var(--color-bg-subtle)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() =>
            onPropsChange(field.id, {
              isDisabled: option.value === "disabled",
              isHidden: option.value === "hidden",
              isReadOnly: option.value === "readOnly",
            })
          }
          className={[
            "flex-1 rounded-sm px-1 text-[10px] transition",
            current === option.value
              ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
              : "text-[var(--color-text-secondary)]",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
