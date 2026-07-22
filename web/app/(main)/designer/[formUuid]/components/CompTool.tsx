"use client";

import { useMemo, useState } from "react";
import type { Key } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  DateRangePicker,
  Input,
  InputGroup,
  Link,
  ListBox,
  NumberField,
  Radio,
  RadioGroup,
  RangeCalendar,
  Select,
} from "@heroui/react";
import { DateInputGroup } from "@heroui/react/date-input-group";
import { Description } from "@heroui/react/description";
import { parseDate } from "@internationalized/date";
import {
  FormIcon,
  FolderIcon,
  GridIcon,
  LinkIcon as AppLinkIcon,
  MessageIcon,
} from "../../../../components/app-icons";

export const COMPONENT_GROUPS = [
  { key: "basic", label: "基础" },
  { key: "advanced", label: "高级" },
] as const;

type DesignerComponentGroup = (typeof COMPONENT_GROUPS)[number]["key"];

export const DESIGNER_COMPONENTS = [
  {
    type: "groupContainer",
    label: "分组组件",
    placeholder: "",
    icon: "组",
    group: "advanced",
  },
  {
    type: "subform",
    label: "子表单",
    placeholder: "",
    icon: "表",
    group: "advanced",
  },
  {
    type: "associationFormField",
    label: "关联表单",
    placeholder: "请选择关联记录",
    icon: "关",
    group: "advanced",
  },
  {
    type: "singleLineText",
    label: "单行文本",
    placeholder: "请输入单行文本",
    icon: "Aa",
    group: "basic",
  },
  {
    type: "description",
    label: "描述",
    placeholder: "请输入描述内容",
    icon: "述",
    group: "basic",
  },
  {
    type: "multiLineText",
    label: "多行文本",
    placeholder: "请输入多行文本",
    icon: "Tx",
    group: "basic",
  },
  {
    type: "number",
    label: "数值",
    placeholder: "请输入数值",
    icon: "12",
    group: "basic",
  },
  {
    type: "radio",
    label: "单选框",
    placeholder: "",
    icon: "单",
    group: "basic",
  },
  {
    type: "checkbox",
    label: "复选框",
    placeholder: "",
    icon: "多",
    group: "basic",
  },
  {
    type: "select",
    label: "下拉菜单",
    placeholder: "请选择",
    icon: "选",
    group: "basic",
  },
  {
    type: "multiSelect",
    label: "下拉复选",
    placeholder: "请选择多项",
    icon: "复",
    group: "basic",
  },
  {
    type: "link",
    label: "链接",
    placeholder: "",
    icon: "🔗",
    group: "basic",
  },
  {
    type: "date",
    label: "日期",
    placeholder: "请选择日期",
    icon: "日",
    group: "basic",
  },
  {
    type: "dateRange",
    label: "日期区间",
    placeholder: "请选择日期区间",
    icon: "期",
    group: "basic",
  },
  {
    type: "attachment",
    label: "附件",
    placeholder: "上传附件",
    icon: "附",
    group: "basic",
  },
  {
    type: "imageUpload",
    label: "图片上传",
    placeholder: "上传图片",
    icon: "图",
    group: "basic",
  },
  {
    type: "member",
    label: "成员",
    placeholder: "请选择成员",
    icon: "员",
    group: "basic",
  },
  {
    type: "department",
    label: "部门",
    placeholder: "请选择部门",
    icon: "部",
    group: "basic",
  },
  {
    type: "button",
    label: "按钮",
    placeholder: "",
    icon: "钮",
    group: "basic",
  },
] as const satisfies ReadonlyArray<{
  type: string;
  label: string;
  placeholder: string;
  icon: string;
  group: DesignerComponentGroup;
}>;

export type DesignerComponentType = (typeof DESIGNER_COMPONENTS)[number]["type"];

export type DesignerFieldOption = {
  label: string;
  value: string;
};

export type DesignerDefaultValueType = "custom" | "formula" | "linkage";

export type DesignerFieldProps = {
  placeholder?: string;
  description?: string;
  defaultValueType?: DesignerDefaultValueType;
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
  options?: DesignerFieldOption[];
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
  associationFormId?: string;
  associationFormName?: string;
  associationAppId?: string;
  associationPrimaryFieldId?: string;
  associationSecondaryFieldId?: string;
  associationTableFieldIds?: string[];
  associationFilters?: Array<{ fieldId: string; operator: string; value: string }>;
  associationFiltersEnabled?: boolean;
  associationFills?: Array<{ sourceFieldId: string; targetFieldId: string }>;
  associationSubformFills?: Array<{
    sourceSubformId: string;
    targetSubformId: string;
    mappings: Array<{ sourceFieldId: string; targetFieldId: string }>;
  }>;
  associationFillsEnabled?: boolean;
  associationSorts?: Array<{ fieldId: string; direction: "asc" | "desc" }>;
  associationSortsEnabled?: boolean;
  memberOrganizationSource?: "local" | "dingtalk" | "wecom" | "feishu";
  memberSelectableScope?: "all" | "roles" | "members";
  memberRoleIds?: string[];
  memberUserIds?: string[];
  memberDisplayFormat?: "name" | "nameJobNumber" | "nameUserId";
  memberMultiple?: boolean;
};

const DEFAULT_OPTIONS: DesignerFieldOption[] = [
  { label: "选项一", value: "选项一" },
  { label: "选项二", value: "选项二" },
];

const DEFAULT_MEMBER_OPTIONS: DesignerFieldOption[] = [
  { label: "张三", value: "zhangsan" },
  { label: "李四", value: "lisi" },
  { label: "王五", value: "wangwu" },
];

const DEFAULT_DEPARTMENT_OPTIONS: DesignerFieldOption[] = [
  { label: "产品部", value: "product" },
  { label: "研发部", value: "engineering" },
  { label: "运营部", value: "operations" },
];

export function isDesignerComponentType(
  value: string,
): value is DesignerComponentType {
  return DESIGNER_COMPONENTS.some((component) => component.type === value);
}

export function getDesignerComponent(type: DesignerComponentType) {
  return DESIGNER_COMPONENTS.find((component) => component.type === type)!;
}

export function getDefaultOptions(type?: DesignerComponentType) {
  if (type === "member") {
    return DEFAULT_MEMBER_OPTIONS.map((option) => ({ ...option }));
  }

  if (type === "department") {
    return DEFAULT_DEPARTMENT_OPTIONS.map((option) => ({ ...option }));
  }

  return DEFAULT_OPTIONS.map((option) => ({ ...option }));
}

export function getDefaultDesignerFieldProps(
  type: DesignerComponentType,
): DesignerFieldProps {
  const component = getDesignerComponent(type);
  const commonProps = {
    description: "",
    defaultValueFormula: "",
    defaultValueLinkage: "",
    defaultValueType: "custom" as DesignerDefaultValueType,
    isDisabled: false,
    isHidden: false,
    isReadOnly: false,
    isRequired: false,
  };

  if (type === "number") {
    return {
      ...commonProps,
      defaultValue: 0,
      placeholder: component.placeholder,
      showClearButton: false,
      showCounter: false,
      step: 1,
    };
  }

  if (type === "groupContainer") {
    return {
      ...commonProps,
      description: "用于收纳子组件的分组容器。",
    };
  }

  if (type === "subform") {
    return {
      ...commonProps,
      defaultValue: [],
      subformAddButtonText: "新增一项",
      subformButtonState: "normal",
      subformAllowBatchImport: true,
      subformAllowExcelExport: true,
      subformAllowBatchDelete: false,
      subformFilterEmptyRows: true,
      subformShowActionColumn: true,
      subformShowCopyButton: false,
      subformShowDeleteButton: true,
      subformDeleteButtonText: "删除",
      subformConfirmDelete: true,
      subformShowSort: false,
      subformDisplayMode: "desktop",
      subformArrangement: "table",
      subformTheme: "divider",
      subformShowHeader: true,
      subformShowIndex: true,
      subformLayoutMode: "fixed",
      subformPageSize: 20,
      subformMaxRows: 500,
      subformFrozenLeftColumns: 0,
      subformFreezeActionColumn: true,
      subformActionColumnWidth: 70,
      subformAllowCustomColumns: false,
      subformEnableTotals: false,
    };
  }

  if (type === "associationFormField") {
    return {
      ...commonProps,
      defaultValue: "",
      placeholder: component.placeholder,
      associationFormId: "",
      associationAppId: "",
      associationPrimaryFieldId: "",
      associationSecondaryFieldId: "",
      associationTableFieldIds: [],
      associationFilters: [],
      associationFills: [],
      associationSubformFills: [],
      associationSorts: [],
    };
  }

  if (type === "multiLineText") {
    return {
      ...commonProps,
      defaultValue: "",
      placeholder: component.placeholder,
      showClearButton: false,
      showCounter: false,
      rows: 2,
    };
  }

  if (type === "description") {
    return {
      ...commonProps,
      defaultValue: "这是一段描述说明。",
      placeholder: component.placeholder,
    };
  }

  if (type === "radio") {
    return {
      ...commonProps,
      defaultValue: "选项一",
      options: getDefaultOptions(type),
      orientation: "horizontal",
    };
  }

  if (type === "checkbox" || type === "multiSelect") {
    return {
      ...commonProps,
      defaultValue: [],
      options: getDefaultOptions(type),
      orientation: "horizontal",
      placeholder: component.placeholder,
    };
  }

  if (type === "member") {
    return {
      ...commonProps,
      defaultValue: "",
      placeholder: component.placeholder,
      memberOrganizationSource: "local",
      memberSelectableScope: "all",
      memberRoleIds: [],
      memberUserIds: [],
      memberDisplayFormat: "name",
      memberMultiple: false,
    };
  }

  if (type === "select" || type === "department") {
    return {
      ...commonProps,
      defaultValue: "",
      options: getDefaultOptions(type),
      placeholder: component.placeholder,
    };
  }

  if (type === "link") {
    return {
      ...commonProps,
      defaultValue: "打开链接",
      href: "https://example.com",
      target: "_blank",
    };
  }

  if (type === "date") {
    return {
      ...commonProps,
      defaultValue: "",
      placeholder: component.placeholder,
    };
  }

  if (type === "dateRange") {
    return {
      ...commonProps,
      defaultValue: ["", ""],
      placeholder: component.placeholder,
    };
  }

  if (type === "attachment") {
    return {
      ...commonProps,
      accept: "",
      buttonText: "上传附件",
      multiple: true,
      placeholder: component.placeholder,
    };
  }

  if (type === "imageUpload") {
    return {
      ...commonProps,
      accept: "image/*",
      buttonText: "上传图片",
      multiple: true,
      placeholder: component.placeholder,
    };
  }

  if (type === "button") {
    return {
      ...commonProps,
      buttonText: "按钮",
    };
  }

  return {
    ...commonProps,
    defaultValue: "",
    placeholder: component.placeholder,
    showClearButton: false,
    showCounter: false,
  };
}

type CompToolProps = {
  embedded?: boolean;
};

export function CompTool({ embedded = false }: CompToolProps) {
  const [searchKeyword, setSearchKeyword] = useState("");
  const normalizedKeyword = searchKeyword.trim();
  const groupedComponents = useMemo(
    () =>
      COMPONENT_GROUPS.map((group) => ({
        ...group,
        components: DESIGNER_COMPONENTS.filter(
          (component) =>
            component.group === group.key &&
            component.label.includes(normalizedKeyword),
        ),
      })),
    [normalizedKeyword],
  );

  const content = (
    <>
      {embedded ? null : (
        <div className="mb-3 shrink-0">
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">组件箱</h2>
        </div>
      )}

      <Input
        aria-label="搜索组件"
        className="mb-3 shrink-0 text-xs font-normal"
        placeholder="搜索组件中文名"
        value={searchKeyword}
        onChange={(event) => setSearchKeyword(event.currentTarget.value)}
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {groupedComponents.map((group) => (
          <section key={group.key}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-normal text-[var(--color-text-primary)]">
                {group.label}
              </h3>
              <span className="text-xs font-normal text-[var(--color-text-disabled)]">
                {group.components.length}
              </span>
            </div>

            {group.components.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {group.components.map((component) => (
                  <DraggableComponentCard
                    key={component.type}
                    component={component}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-4 text-center text-xs font-normal text-[var(--color-text-disabled)]">
                {normalizedKeyword ? "未匹配到组件" : "暂无组件"}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex h-full min-h-0 min-w-0 flex-col">{content}</div>;
  }

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-[var(--shadow-panel)] backdrop-blur">
      {content}
    </aside>
  );
}

function DraggableComponentCard({
  component,
}: {
  component: (typeof DESIGNER_COMPONENTS)[number];
}) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: `component:${component.type}`,
    data: {
      kind: "component",
      componentType: component.type,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? "opacity-40" : ""}
      style={{ touchAction: "none" }}
    >
      <Card className="cursor-grab rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2 shadow-none transition hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] hover:shadow-[var(--shadow-card-hover)] active:cursor-grabbing">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-xs font-normal text-[var(--color-primary)]">
            <ComponentPaletteIcon type={component.type} fallback={component.icon} />
          </span>
          <span className="truncate text-xs font-normal text-[var(--color-text-primary)]">
            {component.label}
          </span>
        </div>
      </Card>
    </div>
  );
}

function ComponentPaletteIcon({
  type,
  fallback,
}: {
  type: DesignerComponentType;
  fallback: string;
}) {
  if (type === "groupContainer") {
    return <FolderIcon />;
  }

  if (type === "subform") {
    return <GridIcon />;
  }

  if (type === "associationFormField") {
    return <FormIcon />;
  }

  if (type === "description") {
    return <MessageIcon />;
  }

  if (type === "link") {
    return <AppLinkIcon />;
  }

  if (type === "attachment" || type === "imageUpload") {
    return <GridIcon />;
  }

  if (type === "date" || type === "dateRange") {
    return <FormIcon />;
  }

  return <span>{fallback}</span>;
}

export function FieldPreview({
  type,
  label,
  compact = false,
  showLabel = true,
  componentProps,
}: {
  type: DesignerComponentType;
  label: string;
  compact?: boolean;
  showLabel?: boolean;
  componentProps?: DesignerFieldProps;
}) {
  const component = getDesignerComponent(type);
  const fieldProps = {
    ...getDefaultDesignerFieldProps(type),
    ...componentProps,
  };
  const placeholder =
    fieldProps.placeholder ?? (showLabel ? component.placeholder : "请输入");
  const description = fieldProps.description?.trim();
  const textDefaultValue =
    typeof fieldProps.defaultValue === "string"
      ? fieldProps.defaultValue
      : undefined;
  const numberDefaultValue =
    typeof fieldProps.defaultValue === "number" ? fieldProps.defaultValue : 0;
  const choiceOptions = normalizeFieldOptions(fieldProps.options, type);
  const choiceDefaultValue =
    typeof fieldProps.defaultValue === "string" ? fieldProps.defaultValue : "";
  const multiDefaultValue = Array.isArray(fieldProps.defaultValue)
    ? fieldProps.defaultValue
    : [];
  const orientation =
    type === "radio" || type === "checkbox"
      ? "horizontal"
      : (fieldProps.orientation ?? "vertical");

  return (
    <div
      className={[
        type === "multiLineText" ? "flex h-full min-w-0 flex-1 flex-col gap-2" : "w-full min-w-0 flex-1 space-y-2",
        fieldProps.isHidden ? "opacity-40" : "",
      ].join(" ")}
    >
      {showLabel && type !== "button" ? (
        <label className="block text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </label>
      ) : null}
      {type === "groupContainer" ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-primary)] bg-[var(--color-bg-subtle)] p-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {label}
            </span>
            <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">Group</span>
          </div>
          <div className="mt-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-5 text-center text-xs text-[var(--color-text-secondary)]">
            将组件拖拽到此分组中
          </div>
        </div>
      ) : null}
      {type === "subform" ? (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2"><span className="text-sm font-semibold">{label}</span><span className="text-xs text-[var(--color-text-secondary)]">子表单</span></div>
          <div className="grid grid-cols-3 divide-x divide-[var(--color-border)] text-center text-xs text-[var(--color-text-secondary)]"><span className="p-2">字段列</span><span className="p-2">字段列</span><span className="p-2">操作</span></div>
        </div>
      ) : null}
      {type === "associationFormField" ? (
        <div className="flex h-10 w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-disabled)]"><span>{fieldProps.associationPrimaryFieldId ? "已配置关联表单" : placeholder}</span><span>⌄</span></div>
      ) : null}
      {type === "singleLineText" ? (
        <div className="relative">
          <Input
            aria-label={label}
            defaultValue={textDefaultValue}
            disabled={fieldProps.isDisabled}
            placeholder={placeholder}
            readOnly={fieldProps.isReadOnly}
            required={fieldProps.isRequired}
            fullWidth
          />
          {fieldProps.showClearButton ? <ClearButtonPreview /> : null}
          {fieldProps.showCounter ? (
            <CounterPreview value={textDefaultValue ?? ""} />
          ) : null}
        </div>
      ) : null}
      {type === "description" ? (
        <p className="rounded-xl bg-[var(--color-bg-subtle)] px-3 py-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          {textDefaultValue || placeholder}
        </p>
      ) : null}
      {type === "multiLineText" ? (
        <div className="relative min-h-20 flex-1">
          <InputGroup fullWidth className="h-full">
            <InputGroup.TextArea
              aria-label={label}
              defaultValue={textDefaultValue}
              disabled={fieldProps.isDisabled}
              placeholder={placeholder}
              readOnly={fieldProps.isReadOnly}
              required={fieldProps.isRequired}
              rows={fieldProps.rows ?? (compact ? 2 : 3)}
              className="h-full min-h-0 w-full resize-none"
            />
          </InputGroup>
          {fieldProps.showClearButton ? <ClearButtonPreview /> : null}
          {fieldProps.showCounter ? (
            <CounterPreview value={textDefaultValue ?? ""} />
          ) : null}
        </div>
      ) : null}
      {type === "number" ? (
        <NumberField
          aria-label={label}
          className="low-code-number-field"
          defaultValue={numberDefaultValue}
          isDisabled={fieldProps.isDisabled}
          isReadOnly={fieldProps.isReadOnly}
          isRequired={fieldProps.isRequired}
          maxValue={fieldProps.maxValue}
          minValue={fieldProps.minValue}
          step={fieldProps.step}
          fullWidth
        >
          <NumberField.Group>
            <NumberField.DecrementButton>-</NumberField.DecrementButton>
            <NumberField.Input placeholder={placeholder} />
            <NumberField.IncrementButton>+</NumberField.IncrementButton>
          </NumberField.Group>
        </NumberField>
      ) : null}
      {type === "radio" ? (
        <RadioGroup
          aria-label={label}
          className={[
            "low-code-choice-field",
            orientation === "horizontal"
              ? "low-code-choice-horizontal"
              : "low-code-choice-vertical",
          ].join(" ")}
          defaultValue={choiceDefaultValue}
          isDisabled={fieldProps.isDisabled}
          isReadOnly={fieldProps.isReadOnly}
          isRequired={fieldProps.isRequired}
        >
          {choiceOptions.map((option) => (
            <Radio key={option.value} value={option.value}>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              <Radio.Content className="text-[12px]">{option.label}</Radio.Content>
            </Radio>
          ))}
        </RadioGroup>
      ) : null}
      {type === "checkbox" ? (
        <CheckboxGroup
          aria-label={label}
          className={[
            "low-code-choice-field",
            orientation === "horizontal"
              ? "low-code-choice-horizontal"
              : "low-code-choice-vertical",
          ].join(" ")}
          defaultValue={multiDefaultValue}
          isDisabled={fieldProps.isDisabled}
          isReadOnly={fieldProps.isReadOnly}
          isRequired={fieldProps.isRequired}
        >
          {choiceOptions.map((option) => (
            <Checkbox key={option.value} value={option.value}>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content className="text-[12px]">{option.label}</Checkbox.Content>
            </Checkbox>
          ))}
        </CheckboxGroup>
      ) : null}
      {type === "select" || type === "member" || type === "department" ? (
        <SelectPreview
          label={label}
          placeholder={placeholder}
          value={choiceDefaultValue}
          options={choiceOptions}
          isDisabled={fieldProps.isDisabled}
          isRequired={fieldProps.isRequired}
        />
      ) : null}
      {type === "multiSelect" ? (
        <MultiSelectPreview
          label={label}
          placeholder={placeholder}
          selectedValues={multiDefaultValue}
          options={choiceOptions}
          isDisabled={fieldProps.isDisabled}
          isRequired={fieldProps.isRequired}
        />
      ) : null}
      {type === "link" ? (
        <Link
          href={fieldProps.href || "#"}
          target={fieldProps.target}
          className="text-sm font-medium text-[var(--color-primary)]"
        >
          {textDefaultValue || label}
        </Link>
      ) : null}
      {type === "date" ? (
        <Input
          aria-label={label}
          defaultValue={textDefaultValue}
          disabled={fieldProps.isDisabled}
          placeholder={placeholder}
          readOnly={fieldProps.isReadOnly}
          required={fieldProps.isRequired}
          type="date"
          fullWidth
        />
      ) : null}
      {type === "dateRange" ? (
        <DateRangePickerPreview
          label={label}
          value={multiDefaultValue}
          isDisabled={fieldProps.isDisabled}
          isReadOnly={fieldProps.isReadOnly}
        />
      ) : null}
      {type === "attachment" || type === "imageUpload" ? (
        <UploadPreview
          accept={fieldProps.accept}
          buttonText={fieldProps.buttonText || placeholder}
          imageOnly={type === "imageUpload"}
        />
      ) : null}
      {type === "button" ? (
        <Button isDisabled={fieldProps.isDisabled}>
          {fieldProps.buttonText || label}
        </Button>
      ) : null}
      {description ? (
        <Description className="text-sm text-[var(--color-text-secondary)]">
          {description}
        </Description>
      ) : null}
    </div>
  );
}

export function normalizeFieldOptions(
  options?: DesignerFieldOption[],
  type?: DesignerComponentType,
) {
  return options && options.length > 0 ? options : getDefaultOptions(type);
}

function SelectPreview({
  isDisabled,
  isRequired,
  label,
  options,
  placeholder,
  value,
}: {
  isDisabled?: boolean;
  isRequired?: boolean;
  label: string;
  options: DesignerFieldOption[];
  placeholder: string;
  value: string;
}) {
  const [selectedValue, setSelectedValue] = useState(value);

  return (
    <Select
      aria-label={label}
      className="low-code-select-field"
      selectedKey={selectedValue || null}
      onSelectionChange={(key: Key | null) =>
        setSelectedValue(key === null ? "" : String(key))
      }
      isDisabled={isDisabled}
      isRequired={isRequired}
      fullWidth
    >
      <Select.Trigger>
        <Select.Value>
          {getOptionLabel(options, selectedValue) || placeholder}
        </Select.Value>
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

function MultiSelectPreview({
  isDisabled,
  isRequired,
  label,
  options,
  placeholder,
  selectedValues: initialSelectedValues,
}: {
  isDisabled?: boolean;
  isRequired?: boolean;
  label: string;
  options: DesignerFieldOption[];
  placeholder: string;
  selectedValues: string[];
}) {
  const [selectedValues, setSelectedValues] = useState(initialSelectedValues);
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabels = selectedValues
    .map((v) => getOptionLabel(options, v))
    .filter(Boolean);

  return (
    <div className="relative low-code-select-field">
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={isDisabled}
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 truncate">
          {selectedLabels.length > 0 ? selectedLabels.join("、") : placeholder}
        </span>
        <span aria-hidden="true" className="shrink-0 text-[var(--color-text-disabled)]">
          v
        </span>
      </button>

      {isOpen ? (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-[var(--shadow-floating)]">
          <CheckboxGroup
            aria-label={label}
            value={selectedValues}
            onChange={setSelectedValues}
            isDisabled={isDisabled}
            isRequired={isRequired}
          >
          {options.map((option) => (
            <Checkbox
              key={option.value}
              value={option.value}
            >
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content>
              {option.label}
              </Checkbox.Content>
            </Checkbox>
          ))}
          </CheckboxGroup>
        </div>
      ) : null}
    </div>
  );
}

function UploadPreview({
  buttonText,
  imageOnly,
}: {
  accept?: string;
  buttonText: string;
  imageOnly: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
      <Button size="sm" variant="ghost">
        {buttonText}
      </Button>
      <p className="mt-2 text-xs text-[var(--color-text-disabled)]">
        {imageOnly ? "支持图片上传" : "支持附件上传"}
      </p>
    </div>
  );
}

function DateRangePickerPreview({
  isDisabled,
  isReadOnly,
  label,
  value,
}: {
  isDisabled?: boolean;
  isReadOnly?: boolean;
  label: string;
  value: string[];
}) {
  const defaultValue = getDateRangeValue(value);

  return (
    <DateRangePicker
      aria-label={label}
      className="low-code-date-range-picker w-full"
      defaultValue={defaultValue as never}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
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
              {(day) => (
                <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>
              )}
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

function getOptionLabel(options: DesignerFieldOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function ClearButtonPreview() {
  return (
    <span className="pointer-events-none absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-xs text-[var(--color-text-secondary)]">
      ×
    </span>
  );
}

function CounterPreview({ value }: { value: string }) {
  return (
    <div className="pointer-events-none absolute -bottom-5 right-0 text-xs text-[var(--color-text-disabled)]">
      {value.length}/500
    </div>
  );
}
