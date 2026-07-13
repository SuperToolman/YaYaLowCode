/**
 * 字段默认值编辑器
 * */



"use client";

import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Button, Input, InputGroup } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import {
  type DesignerDefaultValueType,
  normalizeFieldOptions,
  type DesignerFieldOption,
} from "../CompTool";
import { toOptionalNumber } from "../../designer-options";
import type {
  FieldPropsChangeHandler,
  PlacedField,
} from "../../designer-types";
import { FormulaEditor } from "./FormulaEditor";
import { useTheme } from "../../../../../components/theme-provider";
import { FORMULA_FUNCTION_ITEMS } from "./formula-definitions";
import { NumberWithActions } from "./PropertyLayout";
import {
  findDuplicateFormulaLabels,
  formulaToDisplay,
  formulaToStored,
} from "../../../../../lib/form-formula";

const DEFAULT_VALUE_TYPE_OPTIONS: Array<{
  label: string;
  value: DesignerDefaultValueType;
}> = [
  { label: "自定义", value: "custom" },
  { label: "公式编辑", value: "formula" },
  { label: "数据联动", value: "linkage" },
];

export function DefaultValueEditor({
  fields,
  field,
  onPropsChange,
}: {
  fields: PlacedField[];
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const defaultValueType = field.props.defaultValueType ?? "custom";

  function handleDefaultValueTypeChange(value: DesignerDefaultValueType) {
    onPropsChange(field.id, {
      defaultValueType: value,
      defaultValueFormula:
        value === "formula"
          ? field.props.defaultValueFormula ||
            getDefaultValueFormulaSeed(field.props.defaultValue)
          : field.props.defaultValueFormula,
    });
  }

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <DefaultValueTypeSegmented
        value={defaultValueType}
        onChange={handleDefaultValueTypeChange}
      />
      {defaultValueType === "custom" ? (
        <CustomDefaultValueEditor field={field} onPropsChange={onPropsChange} />
      ) : null}
      {defaultValueType === "formula" ? (
        <FormulaDefaultValueEditor
          fields={fields}
          field={field}
          onPropsChange={onPropsChange}
        />
      ) : null}
      {defaultValueType === "linkage" ? <DataLinkagePlaceholder /> : null}
    </div>
  );
}

function CustomDefaultValueEditor({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  if (field.type === "number") {
    return (
      <NumberWithActions
        value={toOptionalNumber(field.props.defaultValue)}
        onChange={(value) =>
          onPropsChange(field.id, { defaultValue: value ?? 0 })
        }
      />
    );
  }

  if (
    field.type === "radio" ||
    field.type === "select" ||
    field.type === "member" ||
    field.type === "department"
  ) {
    const value =
      typeof field.props.defaultValue === "string"
        ? field.props.defaultValue
        : "";

    return (
      <ChoiceDefaultSelect
        options={normalizeFieldOptions(field.props.options, field.type)}
        value={value}
        onChange={(nextValue) =>
          onPropsChange(field.id, { defaultValue: nextValue })
        }
      />
    );
  }

  if (field.type === "checkbox" || field.type === "multiSelect") {
    const value = Array.isArray(field.props.defaultValue)
      ? field.props.defaultValue
      : [];

    return (
      <CheckboxDefaultEditor
        options={normalizeFieldOptions(field.props.options, field.type)}
        value={value}
        onChange={(nextValue) =>
          onPropsChange(field.id, { defaultValue: nextValue })
        }
      />
    );
  }

  if (field.type === "date") {
    const value =
      typeof field.props.defaultValue === "string"
        ? field.props.defaultValue
        : "";

    return (
      <Input
        aria-label="默认日期"
        className="min-w-0 flex-1"
        type="date"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onPropsChange(field.id, { defaultValue: event.currentTarget.value })
        }
      />
    );
  }

  if (field.type === "dateRange") {
    const value = Array.isArray(field.props.defaultValue)
      ? field.props.defaultValue
      : ["", ""];

    return (
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
        <Input
          aria-label="默认开始日期"
          type="date"
          value={value[0] ?? ""}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onPropsChange(field.id, {
              defaultValue: [event.currentTarget.value, value[1] ?? ""],
            })
          }
        />
        <Input
          aria-label="默认结束日期"
          type="date"
          value={value[1] ?? ""}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onPropsChange(field.id, {
              defaultValue: [value[0] ?? "", event.currentTarget.value],
            })
          }
        />
      </div>
    );
  }

  const value =
    typeof field.props.defaultValue === "string" ? field.props.defaultValue : "";

  return (
    <div className="min-w-0 space-y-2">
      <InputGroup fullWidth>
        <InputGroup.TextArea
          aria-label="默认值"
          placeholder="请输入默认值"
          rows={3}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            onPropsChange(field.id, {
              defaultValue: event.currentTarget.value,
            })
          }
        />
      </InputGroup>
      <div className="text-right text-xs text-[var(--color-text-secondary)]">{value.length}/500</div>
    </div>
  );
}

function FormulaDefaultValueEditor({
  fields,
  field,
  onPropsChange,
}: {
  fields: PlacedField[];
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const value =
    field.props.defaultValueFormula ??
    getDefaultValueFormulaSeed(field.props.defaultValue);

  return (
    <div className="min-w-0 space-y-2">
      <Button
        fullWidth
        size="sm"
        variant="ghost"
        className="border border-[var(--designer-border)] bg-[var(--designer-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        onPress={() => setIsOpen(true)}
      >
        {value.trim() ? "编辑公式" : "添加公式"}
      </Button>
      {value.trim() ? (
        <div className="truncate rounded-lg bg-[var(--designer-surface-soft)] px-2 py-1 font-mono text-xs text-[var(--color-text-secondary)]">
          {formulaToDisplay(value, fields)}
        </div>
      ) : null}
      <FormulaEditorModal
        currentFieldId={field.id}
        fields={fields}
        isOpen={isOpen}
        fieldLabel={field.label}
        value={value}
        onOpenChange={setIsOpen}
        onChange={(nextValue) =>
          onPropsChange(field.id, { defaultValueFormula: nextValue })
        }
      />
    </div>
  );
}

function FormulaEditorModal({
  currentFieldId,
  fieldLabel,
  fields,
  isOpen,
  onChange,
  onOpenChange,
  value,
}: {
  currentFieldId: string;
  fieldLabel: string;
  fields: PlacedField[];
  isOpen: boolean;
  onChange: (value: string) => void;
  onOpenChange: (isOpen: boolean) => void;
  value: string;
}) {
  const { resolvedTheme } = useTheme();
  const [draftValue, setDraftValue] = useState(() => formulaToDisplay(value, fields));
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);

  function handleOpenChange(nextIsOpen: boolean) {
    if (nextIsOpen) {
      setDraftValue(formulaToDisplay(value, fields));
    }

    onOpenChange(nextIsOpen);
  }

  function insertFormulaText(text: string) {
    const textarea = formulaInputRef.current;

    if (!textarea) {
      setDraftValue((currentValue) => `${currentValue}${text}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = textarea.value;
    const nextValue = `${currentValue.slice(0, start)}${text}${currentValue.slice(
      end,
    )}`;
    const nextPosition = start + text.length;

    setDraftValue(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextPosition, nextPosition);
    });
  }

  function confirmFormula() {
    onChange(formulaToStored(draftValue, fields));
    onOpenChange(false);
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Modal.Backdrop className="designer-modal-backdrop" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="cover">
          <Modal.Dialog
            data-theme={resolvedTheme}
            className="designer-theme-surface flex h-[84vh] w-[min(1240px,92vw)] max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-[var(--designer-surface-solid)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"
          >
            <Modal.Header className="border-b border-[var(--designer-border)] bg-[var(--designer-surface-solid)] px-5 py-4">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Modal.Heading className="truncate text-xl font-semibold text-[var(--color-text-primary)]">
                    公式编辑
                  </Modal.Heading>
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    使用数学运算符编辑公式
                  </span>
                </div>
                <Modal.CloseTrigger
                  aria-label="关闭公式编辑"
                  className="shrink-0"
                />
              </div>
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-hidden bg-[var(--designer-surface-soft)] p-4">
              <div className="flex min-h-full flex-col overflow-hidden rounded-lg border border-[var(--designer-border)] bg-[var(--designer-surface-solid)]">
                <div className="border-b border-[var(--designer-border)] bg-[var(--designer-surface-muted)] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-sm font-semibold text-[var(--color-text-primary)]">
                      {fieldLabel} =
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                      <ToolbarButton onPress={() => navigator.clipboard?.writeText(draftValue)}>
                        复制
                      </ToolbarButton>
                      <ToolbarButton onPress={() => setDraftValue("")}>
                        清空
                      </ToolbarButton>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    编辑公式时支持空格、tab 缩进和回车换行
                  </p>
                </div>

                <div className="formula-modal-editor min-h-[230px] flex-1 border-b border-[var(--designer-border)] bg-[var(--designer-surface-solid)] p-3">
                  <FormulaEditor
                    ref={formulaInputRef}
                    value={draftValue}
                    onChange={setDraftValue}
                  />
                </div>

                <div className="grid h-[300px] min-h-0 grid-cols-[minmax(220px,0.9fr)_minmax(280px,1.15fr)_minmax(260px,1fr)] divide-x divide-[var(--designer-border)] overflow-hidden">
                  <FormulaVariablePanel
                    currentFieldId={currentFieldId}
                    fields={fields}
                    onInsert={insertFormulaText}
                  />
                  <FormulaFunctionPanel onInsert={insertFormulaText} />
                  <FormulaHelpPanel />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="border-t border-[var(--designer-border)] bg-[var(--designer-surface-solid)] px-5 py-3">
              <div className="flex w-full justify-end gap-3">
                <Button variant="ghost" onPress={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button onPress={confirmFormula}>确定</Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ToolbarButton({
  children,
  onPress,
}: {
  children: string;
  onPress: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onPress}
      className="min-h-7 rounded-md border border-transparent px-2 py-1 text-[var(--color-text-secondary)] transition hover:border-[var(--designer-border)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
    >
      {children}
    </Button>
  );
}

function FormulaVariablePanel({
  currentFieldId,
  fields,
  onInsert,
}: {
  currentFieldId: string;
  fields: PlacedField[];
  onInsert: (value: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  const duplicateLabels = findDuplicateFormulaLabels(fields);
  const rootFields = fields
    .filter((field) => field.id !== currentFieldId && !field.parentGroupId)
    .sort((left, right) => left.row - right.row || left.column - right.column);
  const matchesField = (field: PlacedField) =>
    !normalizedKeyword || field.label.toLocaleLowerCase().includes(normalizedKeyword);
  const visibleRoots = rootFields.filter(
    (field) =>
      matchesField(field) ||
      fields.some(
        (child) => child.parentGroupId === field.id && child.id !== currentFieldId && matchesField(child),
      ),
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-[var(--designer-surface-solid)]">
      <div className="shrink-0 border-b border-[var(--designer-border)] px-3 py-2">
        <Input
          aria-label="搜索变量"
          placeholder="搜索变量"
          value={keyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setKeyword(event.currentTarget.value)
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <div className="mb-2 rounded-md bg-[var(--designer-surface-soft)] px-2 py-1.5 text-sm">
          <span className="font-medium text-[var(--color-text-primary)]">当前设计器组件</span>
          <span className="ml-2 text-xs text-[var(--color-text-secondary)]">按组件名称搜索</span>
        </div>
        <div className="space-y-1">
          {visibleRoots.length > 0 ? (
            visibleRoots.map((field) => (
              <FormulaFieldTreeNode
                key={field.id}
                currentFieldId={currentFieldId}
                duplicateLabels={duplicateLabels}
                field={field}
                fields={fields}
                keyword={normalizedKeyword}
                level={0}
                onInsert={onInsert}
              />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-xs text-[var(--color-text-disabled)]">
              暂无可用组件
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FormulaFieldTreeNode({
  currentFieldId,
  duplicateLabels,
  field,
  fields,
  keyword,
  level,
  onInsert,
}: {
  currentFieldId: string;
  duplicateLabels: Set<string>;
  field: PlacedField;
  fields: PlacedField[];
  keyword: string;
  level: number;
  onInsert: (value: string) => void;
}) {
  const parentMatches = !keyword || field.label.toLocaleLowerCase().includes(keyword);
  const children = fields
    .filter((item) => item.parentGroupId === field.id && item.id !== currentFieldId)
    .filter(
      (item) => parentMatches || item.label.toLocaleLowerCase().includes(keyword),
    )
    .sort((left, right) => left.row - right.row || left.column - right.column);
  const isContainer = field.type === "groupContainer";
  const hasDuplicateLabel = duplicateLabels.has(field.label);

  return (
    <div>
      <button
        type="button"
        disabled={isContainer || hasDuplicateLabel}
        title={hasDuplicateLabel ? "组件名称重复，请先修改为唯一名称" : undefined}
        onClick={() => onInsert(`[${field.label}]`)}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition enabled:hover:border-[var(--designer-border)] enabled:hover:bg-[var(--color-bg-hover)] disabled:cursor-default"
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xs text-[var(--color-text-secondary)]">
          {isContainer ? "▾" : "└"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
          {field.label}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
          {hasDuplicateLabel ? "名称重复" : getFormulaVariableTypeLabel(field.type)}
        </span>
      </button>
      {children.map((child) => (
        <FormulaFieldTreeNode
          key={child.id}
          currentFieldId={currentFieldId}
          duplicateLabels={duplicateLabels}
          field={child}
          fields={fields}
          keyword={keyword}
          level={level + 1}
          onInsert={onInsert}
        />
      ))}
    </div>
  );
}

function getFormulaVariableTypeLabel(type: PlacedField["type"]) {
  if (type === "number") {
    return "数字";
  }

  if (type === "date" || type === "dateRange") {
    return "时间戳";
  }

  if (type === "checkbox" || type === "multiSelect") {
    return "数组";
  }

  if (type === "attachment" || type === "imageUpload") {
    return "文件";
  }

  if (type === "button") {
    return "按钮";
  }

  return "文本";
}

function FormulaFunctionPanel({
  onInsert,
}: {
  onInsert: (value: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const functions = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return FORMULA_FUNCTION_ITEMS;
    }

    return FORMULA_FUNCTION_ITEMS.filter((formulaFunction) =>
      [
        formulaFunction.name,
        formulaFunction.label,
        formulaFunction.description,
        formulaFunction.group,
      ].some((item) => item.toLowerCase().includes(normalizedKeyword)),
    );
  }, [keyword]);
  const groupedFunctions = useMemo(
    () =>
      functions.reduce<Array<{ group: string; items: typeof functions }>>(
        (groups, item) => {
          const currentGroup = groups.find((group) => group.group === item.group);
          if (currentGroup) currentGroup.items.push(item);
          else groups.push({ group: item.group, items: [item] });
          return groups;
        },
        [],
      ),
    [functions],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-[var(--designer-surface-solid)]">
      <div className="shrink-0 border-b border-[var(--designer-border)] px-3 py-2">
        <Input
          aria-label="搜索函数"
          placeholder="搜索函数"
          value={keyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setKeyword(event.currentTarget.value)
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">函数</div>
        <div className="space-y-1">
          {groupedFunctions.length > 0 ? (
            groupedFunctions.map((group) => (
              <section key={group.group} className="pb-2">
                <div className="sticky top-0 z-10 mb-1 bg-[var(--designer-surface-solid)] px-1 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                  {group.group} · {group.items.length}
                </div>
                <div className="space-y-1">
                  {group.items.map((formulaFunction) => (
                    <Button
                      key={formulaFunction.name}
                      type="button"
                      variant="ghost"
                      onClick={() => onInsert(`@${formulaFunction.name}()`)}
                      className="block h-auto min-h-[58px] w-full overflow-hidden whitespace-normal rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-[var(--designer-border)] hover:bg-[var(--color-bg-hover)]"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2 text-sm text-[var(--color-text-primary)]">
                        <span className="min-w-0 break-all font-medium leading-5">{formulaFunction.name}</span>
                        <span className="shrink-0 rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] leading-4 text-[var(--color-text-secondary)]">
                          {formulaFunction.label}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 break-words text-xs leading-4 text-[var(--color-text-secondary)]">
                        {formulaFunction.description || formulaFunction.label}
                      </div>
                    </Button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-6 text-center text-xs text-[var(--color-text-disabled)]">
              未找到函数
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FormulaHelpPanel() {
  return (
    <section className="min-h-0 space-y-4 overflow-auto bg-[var(--designer-surface-solid)] px-4 py-3 text-sm leading-6 text-[var(--color-text-secondary)]">
      <p>从左侧面板选择字段名和函数，或输入函数。</p>
      <p>
        公式编辑举例：
        <span className="ml-1 rounded bg-[var(--color-accent-soft)] px-1 text-[var(--color-accent)]">
          AVERAGE(语文成绩, 数学成绩)
        </span>
      </p>
      <div className="space-y-2 rounded-lg bg-[var(--designer-surface-soft)] p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
        <p>点击组件树会插入名称引用，例如：[销售数量]。</p>
        <p>点击函数会插入函数模板，例如：@SUM()。</p>
        <p>支持 +、-、*、/、比较运算和函数嵌套。</p>
      </div>
    </section>
  );
}

function DataLinkagePlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-4 text-center text-xs text-[var(--color-text-disabled)]">
      数据联动暂未配置
    </div>
  );
}

function DefaultValueTypeSegmented({
  onChange,
  value,
}: {
  onChange: (value: DesignerDefaultValueType) => void;
  value: DesignerDefaultValueType;
}) {
  return (
    <div className="flex h-8 rounded-lg bg-[var(--color-bg-subtle)] p-0.5">
      {DEFAULT_VALUE_TYPE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant="ghost"
          onClick={() => onChange(option.value)}
          className={[
            "flex-1 rounded-md px-2 text-xs transition",
            value === option.value
              ? "bg-[var(--designer-surface-solid)] text-[var(--color-text-primary)] shadow-sm"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
          ].join(" ")}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function getDefaultValueFormulaSeed(
  value: string | number | string[] | undefined,
) {
  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return "";
}

function ChoiceDefaultSelect({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: DesignerFieldOption[];
  value: string;
}) {
  return (
    <select
      aria-label="默认选项"
      className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--designer-border)] bg-[var(--color-bg-input)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onChange(event.currentTarget.value)
      }
    >
      <option value="">不设置</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function CheckboxDefaultEditor({
  onChange,
  options,
  value,
}: {
  onChange: (value: string[]) => void;
  options: DesignerFieldOption[];
  value: string[];
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      {options.map((option) => {
        const isSelected = value.includes(option.value);

        return (
          <button
            key={option.value}
            type="button"
            onClick={() =>
              onChange(
                isSelected
                  ? value.filter((item) => item !== option.value)
                  : [...value, option.value],
              )
            }
            className={[
              "mr-1 rounded-lg border px-2.5 py-1 text-xs transition",
              isSelected
                ? "border-[var(--designer-border)] bg-[var(--designer-surface-soft)] text-[var(--color-text-primary)] shadow-sm"
                : "border-[var(--designer-border)] bg-[var(--designer-surface-solid)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
