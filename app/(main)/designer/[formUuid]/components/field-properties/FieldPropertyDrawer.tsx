/**
 * 字段属性抽屉
 * */

"use client";

import { Button } from "@heroui/react";
import type {
  DesignerComponentType,
  DesignerFieldProps,
} from "../CompTool";
import { isChoiceFieldType } from "../../designer-options";
import type {
  FieldPropsChangeHandler,
  PlacedField,
} from "../../designer-types";
import { DefaultValueEditor } from "./DefaultValueEditor";
import { OptionsEditor } from "./OptionsEditor";
import {
  CodeToken,
  IconAction,
  NumberWithActions,
  PanelSwitch,
  PropertyFold,
  PropertyPanel,
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
  "member",
  "department",
]);

const COUNTER_FIELD_TYPES = new Set<DesignerComponentType>([
  "singleLineText",
  "multiLineText",
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
  const supportsOptions = isChoiceFieldType(field.type);

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
                <PropertyPanel>
                  <PropertyRow label="标题">
                    <TextWithActions
                      value={field.label}
                      onChange={(value) => onLabelChange(field.id, value)}
                    />
                  </PropertyRow>
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
                    <StatusSegmented
                      field={field}
                      onPropsChange={onPropsChange}
                    />
                    <IconAction label="表达式" icon={<CodeToken />} />
                  </PropertyRow>
                  {field.type !== "subform" ? <PropertyRow label="默认值" align="start">
                    <DefaultValueEditor
                      fields={fields}
                      field={field}
                      onPropsChange={onPropsChange}
                    />
                  </PropertyRow> : null}
                  {supportsOptions ? (
                    <PropertyRow label="选项" align="start">
                      <OptionsEditor
                        key={field.id}
                        field={field}
                        onPropsChange={onPropsChange}
                      />
                    </PropertyRow>
                  ) : null}
                  <FieldSpecificProperties
                    field={field}
                    onPropsChange={onPropsChange}
                  />
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
                </PropertyPanel>

                {field.type === "subform" ? <SubformProperties field={field} onPropsChange={onPropsChange} /> : null}

                {field.type !== "subform" ? <PropertyFold title="校验">
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
                </PropertyFold> : null}

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
              onChange={(value) =>
                onPropsChange(field.id, { multiple: value })
              }
            />
          </PropertyRow>
        </>
      ) : null}
      {field.type === "button" ? (
        <PropertyRow label="按钮文字">
          <TextWithActions
            value={field.props.buttonText ?? ""}
            onChange={(value) =>
              onPropsChange(field.id, { buttonText: value })
            }
          />
        </PropertyRow>
      ) : null}
    </>
  );
}

function SubformProperties({ field, onPropsChange }: { field: PlacedField; onPropsChange: FieldPropsChangeHandler }) {
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);
  return <>
    <PropertyFold title="子表全局配置">
      <PropertyRow label="按钮名称"><TextWithActions value={field.props.subformAddButtonText ?? "新增一项"} onChange={(value) => update({ subformAddButtonText: value })} /></PropertyRow>
      <PropertyRow label="按钮状态"><PropertySegmented value={field.props.subformButtonState ?? "normal"} options={[{ label: "普通", value: "normal" }, { label: "禁用", value: "disabled" }, { label: "隐藏", value: "hidden" }]} onChange={(value) => update({ subformButtonState: value as "normal" | "disabled" | "hidden" })} /></PropertyRow>
      <PropertyRow label="批量导入"><PanelSwitch isSelected={Boolean(field.props.subformAllowBatchImport)} onChange={(value) => update({ subformAllowBatchImport: value })} /></PropertyRow>
      <PropertyRow label="导出 Excel"><PanelSwitch isSelected={Boolean(field.props.subformAllowExcelExport)} onChange={(value) => update({ subformAllowExcelExport: value })} /></PropertyRow>
      <PropertyRow label="批量删除"><PanelSwitch isSelected={Boolean(field.props.subformAllowBatchDelete)} onChange={(value) => update({ subformAllowBatchDelete: value })} /></PropertyRow>
      <PropertyRow label="过滤空行"><PanelSwitch isSelected={field.props.subformFilterEmptyRows !== false} onChange={(value) => update({ subformFilterEmptyRows: value })} /></PropertyRow>
    </PropertyFold>
    <PropertyFold title="操作项配置">
      <PropertyRow label="复制按钮"><PanelSwitch isSelected={Boolean(field.props.subformShowCopyButton)} onChange={(value) => update({ subformShowCopyButton: value })} /></PropertyRow>
      <PropertyRow label="删除按钮"><PanelSwitch isSelected={field.props.subformShowDeleteButton !== false} onChange={(value) => update({ subformShowDeleteButton: value })} /></PropertyRow>
      <PropertyRow label="按钮名称"><TextWithActions value={field.props.subformDeleteButtonText ?? "删除"} onChange={(value) => update({ subformDeleteButtonText: value })} /></PropertyRow>
      <PropertyRow label="删除确认"><PanelSwitch isSelected={field.props.subformConfirmDelete !== false} onChange={(value) => update({ subformConfirmDelete: value })} /></PropertyRow>
      <PropertyRow label="显示排序"><PanelSwitch isSelected={Boolean(field.props.subformShowSort)} onChange={(value) => update({ subformShowSort: value })} /></PropertyRow>
    </PropertyFold>
    <PropertyFold title="展示样式">
      <PropertyRow label="设备"><PropertySegmented value={field.props.subformDisplayMode ?? "desktop"} options={[{ label: "电脑端", value: "desktop" }, { label: "移动端", value: "mobile" }]} onChange={(value) => update({ subformDisplayMode: value as "desktop" | "mobile" })} /></PropertyRow>
      <PropertyRow label="排列方式"><PropertySegmented value={field.props.subformArrangement ?? "table"} options={[{ label: "平铺方式", value: "tile" }, { label: "表格方式", value: "table" }]} onChange={(value) => update({ subformArrangement: value as "tile" | "table" })} /></PropertyRow>
      <PropertyRow label="主题"><PropertySegmented value={field.props.subformTheme ?? "divider"} options={[{ label: "斑马纹", value: "zebra" }, { label: "分割线", value: "divider" }, { label: "边框线", value: "border" }]} onChange={(value) => update({ subformTheme: value as "zebra" | "divider" | "border" })} /></PropertyRow>
      <PropertyRow label="显示表头"><PanelSwitch isSelected={field.props.subformShowHeader !== false} onChange={(value) => update({ subformShowHeader: value })} /></PropertyRow>
      <PropertyRow label="显示序号"><PanelSwitch isSelected={field.props.subformShowIndex !== false} onChange={(value) => update({ subformShowIndex: value })} /></PropertyRow>
      <PropertyRow label="布局算法"><PropertySegmented value={field.props.subformLayoutMode ?? "fixed"} options={[{ label: "自动", value: "auto" }, { label: "固定", value: "fixed" }]} onChange={(value) => update({ subformLayoutMode: value as "auto" | "fixed" })} /></PropertyRow>
      <PropertyRow label="分页条数"><NumberWithActions min={1} value={field.props.subformPageSize} onChange={(value) => update({ subformPageSize: Math.max(1, value ?? 20) })} /></PropertyRow>
      <PropertyRow label="最大条数"><NumberWithActions min={1} value={field.props.subformMaxRows} onChange={(value) => update({ subformMaxRows: Math.max(1, value ?? 500) })} /></PropertyRow>
      <PropertyRow label="左侧列冻结"><NumberWithActions min={0} value={field.props.subformFrozenLeftColumns} onChange={(value) => update({ subformFrozenLeftColumns: Math.max(0, value ?? 0) })} /></PropertyRow>
      <PropertyRow label="操作列宽"><NumberWithActions min={40} value={field.props.subformActionColumnWidth} onChange={(value) => update({ subformActionColumnWidth: Math.max(40, value ?? 70) })} /></PropertyRow>
      <PropertyRow label="自定义其它列"><PanelSwitch isSelected={Boolean(field.props.subformAllowCustomColumns)} onChange={(value) => update({ subformAllowCustomColumns: value })} /></PropertyRow>
    </PropertyFold>
    <PropertyFold title="合计设置"><PropertyRow label="启用合计"><PanelSwitch isSelected={Boolean(field.props.subformEnableTotals)} onChange={(value) => update({ subformEnableTotals: value })} /></PropertyRow></PropertyFold>
  </>;
}

function PropertySegmented({ value, options, onChange }: { value: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) {
  return <div className="flex h-7 min-w-0 flex-1 rounded-md bg-[var(--color-bg-subtle)] p-0.5">{options.map((option) => <button key={option.value} type="button" onClick={() => onChange(option.value)} className={`min-w-0 flex-1 truncate rounded-sm px-1 text-[10px] ${value === option.value ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"}`}>{option.label}</button>)}</div>;
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
