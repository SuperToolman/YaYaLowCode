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
import { FORMULA_FUNCTION_ITEMS } from "./formula-definitions";
import { NumberWithActions } from "./PropertyLayout";

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
      <div className="text-right text-xs text-[#9aa6b6]">{value.length}/500</div>
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
      <Button fullWidth size="sm" variant="ghost" onPress={() => setIsOpen(true)}>
        {value.trim() ? "编辑公式" : "添加公式"}
      </Button>
      {value.trim() ? (
        <div className="truncate rounded-lg bg-[#f7faff] px-2 py-1 font-mono text-xs text-[#65748f]">
          {value}
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
  const [draftValue, setDraftValue] = useState(value);
  const formulaInputRef = useRef<HTMLTextAreaElement>(null);

  function handleOpenChange(nextIsOpen: boolean) {
    if (nextIsOpen) {
      setDraftValue(value);
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
    onChange(draftValue);
    onOpenChange(false);
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Modal.Backdrop className="bg-[#14213d]/20" isDismissable>
        <Modal.Container placement="center" scroll="inside" size="cover">
          <Modal.Dialog className="flex h-[78vh] w-[78vw] max-w-[78vw] flex-col overflow-hidden rounded-2xl bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <Modal.Header className="border-b border-[#eef2f7] px-5 py-4">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Modal.Heading className="truncate text-xl font-semibold text-[#14213d]">
                    公式编辑
                  </Modal.Heading>
                  <span className="text-sm text-[#8d9aae]">
                    使用数学运算符编辑公式
                  </span>
                </div>
                <Modal.CloseTrigger
                  aria-label="关闭公式编辑"
                  className="shrink-0"
                />
              </div>
            </Modal.Header>
            <Modal.Body className="flex-1 overflow-auto bg-white p-5">
              <div className="flex min-h-full flex-col overflow-hidden rounded-lg border border-[#d7dee9] bg-white">
                <div className="border-b border-[#eef2f7] bg-[#f8fafc] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-sm font-semibold text-[#202f45]">
                      {fieldLabel} =
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs text-[#66758c]">
                      <ToolbarButton onPress={() => navigator.clipboard?.writeText(draftValue)}>
                        复制
                      </ToolbarButton>
                      <ToolbarButton onPress={() => insertFormulaText("$变量")}>
                        替换变量
                      </ToolbarButton>
                      <ToolbarButton onPress={() => insertFormulaText("// 备注")}>
                        备注
                      </ToolbarButton>
                      <ToolbarButton onPress={() => insertFormulaText("@debug()")}>
                        调试
                      </ToolbarButton>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-[#9aa6b6]">
                    编辑公式时支持空格、tab 缩进和回车换行
                  </p>
                </div>

                <div className="formula-modal-editor flex-1 border-b border-[#eef2f7] p-3">
                  <FormulaEditor
                    ref={formulaInputRef}
                    value={draftValue}
                    onChange={setDraftValue}
                  />
                </div>

                <div className="grid min-h-[260px] grid-cols-[260px_190px_minmax(0,1fr)] divide-x divide-[#eef2f7]">
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
            <Modal.Footer className="border-t border-[#eef2f7] px-5 py-3">
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
      onClick={onPress}
      className="rounded-md px-2 py-1 transition hover:bg-[#edf4ff] hover:text-[#2f6bff]"
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
  const variables = getFormulaVariableItems(currentFieldId, fields);
  const filteredVariables = variables.filter((variable) => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return true;
    }

    return [variable.label, variable.type, variable.value].some((item) =>
      item.toLowerCase().includes(normalizedKeyword),
    );
  });

  return (
    <section className="min-w-0 bg-white">
      <div className="border-b border-[#eef2f7] px-3 py-2">
        <Input
          aria-label="搜索变量"
          placeholder="搜索变量"
          value={keyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setKeyword(event.currentTarget.value)
          }
        />
      </div>
      <div className="max-h-[220px] overflow-auto px-3 py-2">
        <div className="mb-2 flex items-center justify-between rounded-md bg-[#f1f4f8] px-2 py-1 text-sm">
          <span className="font-medium text-[#202f45]">当前设计器组件</span>
          <Button
            type="button"
            className="text-xs text-[#2f6bff]"
          >
            切换
          </Button>
        </div>
        <div className="space-y-1">
          {filteredVariables.length > 0 ? (
            filteredVariables.map((variable) => (
              <Button
                key={variable.value}
                type="button"
                onClick={() => onInsert(variable.value)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-[#edf4ff]"
              >
                <span className="truncate text-[#202f45]">
                  {variable.label}
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-xs text-[#2f6bff]">
                  {variable.type}
                </span>
              </Button>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-[#dfe5ee] px-3 py-6 text-center text-xs text-[#9aa6b6]">
              暂无可用组件
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function getFormulaVariableItems(
  currentFieldId: string,
  fields: PlacedField[],
) {
  return fields
    .filter((field) => field.id !== currentFieldId)
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map((field) => {
      const name = getFormulaVariableName(field);

      return {
        field,
        label: field.label,
        name,
        type: getFormulaVariableTypeLabel(field.type),
        value: `$${name}`,
      };
    });
}

function getFormulaVariableName(field: PlacedField) {
  return field.id.replace(/[^A-Za-z0-9_]/g, "_");
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

  return (
    <section className="min-w-0 bg-white">
      <div className="border-b border-[#eef2f7] px-3 py-2">
        <Input
          aria-label="搜索函数"
          placeholder="搜索函数"
          value={keyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setKeyword(event.currentTarget.value)
          }
        />
      </div>
      <div className="max-h-[220px] overflow-auto px-3 py-2">
        <div className="mb-2 text-sm font-medium text-[#202f45]">函数</div>
        <div className="space-y-1">
          {functions.length > 0 ? (
            functions.map((formulaFunction) => (
              <Button
                key={formulaFunction.name}
                type="button"
                onClick={() => onInsert(`@${formulaFunction.name}()`)}
                className="block w-full rounded-md px-2 py-1.5 text-left transition hover:bg-[#edf4ff]"
              >
                <div className="flex items-center justify-between gap-2 text-sm text-[#202f45]">
                  <span>{formulaFunction.name}</span>
                  <span className="shrink-0 rounded-full bg-[#f1f4f8] px-2 py-0.5 text-xs text-[#66758c]">
                    {formulaFunction.group}
                  </span>
                </div>
                <div className="text-xs text-[#9aa6b6]">
                  {formulaFunction.description || formulaFunction.label}
                </div>
              </Button>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-[#dfe5ee] px-3 py-6 text-center text-xs text-[#9aa6b6]">
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
    <section className="space-y-4 bg-white px-4 py-3 text-sm leading-6 text-[#4f6484]">
      <p>从左侧面板选择字段名和函数，或输入函数。</p>
      <p>
        公式编辑举例：
        <span className="ml-1 rounded bg-[#e9fbff] px-1 text-[#0c8aa6]">
          AVERAGE(语文成绩, 数学成绩)
        </span>
      </p>
      <div className="space-y-2 text-[#2f6bff]">
        <Button type="button" className="block text-left">
          观看公式入门视频&gt;
        </Button>
        <Button type="button" className="block text-left">
          观看公式进阶案例&gt;
        </Button>
        <Button type="button" className="block text-left">
          查看所有公式的帮助文档
        </Button>
      </div>
    </section>
  );
}

function DataLinkagePlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-[#dfe5ee] bg-[#fafbfd] px-3 py-4 text-center text-xs text-[#8d9aae]">
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
    <div className="flex h-8 rounded-lg bg-[#f1f3f6] p-0.5">
      {DEFAULT_VALUE_TYPE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={[
            "flex-1 rounded-md px-2 text-xs transition",
            value === option.value
              ? "bg-white text-[#202f45] shadow-sm"
              : "text-[#66758c]",
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
      className="h-9 min-w-0 flex-1 rounded-lg border border-[#dfe5ee] bg-white px-3 text-sm text-[#202f45] outline-none focus:border-[#2f6bff]"
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
                ? "border-[#2f6bff] bg-[#edf4ff] text-[#2f6bff]"
                : "border-[#dfe5ee] bg-white text-[#66758c]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
