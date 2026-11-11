"use client";

import { PropertyNumberField, PropertySegmented, PropertySwitch, PropertyTextField } from "../property-panel/PropertyControls";

import type { DesignerFieldProps } from "../CompTool";

import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";

import { PropertyGroup, PropertyRow } from "../property-panel/PropertyLayout";

export function SubformProperties({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);
  return (
    <>
      <PropertyGroup title="子表全局配置">
        <PropertyRow label="按钮名称">
          <PropertyTextField
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
          <PropertySwitch
            isSelected={Boolean(field.props.subformAllowBatchImport)}
            onChange={(value) => update({ subformAllowBatchImport: value })}
          />
        </PropertyRow>
        <PropertyRow label="导出 Excel">
          <PropertySwitch
            isSelected={Boolean(field.props.subformAllowExcelExport)}
            onChange={(value) => update({ subformAllowExcelExport: value })}
          />
        </PropertyRow>
        <PropertyRow label="批量删除">
          <PropertySwitch
            isSelected={Boolean(field.props.subformAllowBatchDelete)}
            onChange={(value) => update({ subformAllowBatchDelete: value })}
          />
        </PropertyRow>
        <PropertyRow label="过滤空行">
          <PropertySwitch
            isSelected={field.props.subformFilterEmptyRows !== false}
            onChange={(value) => update({ subformFilterEmptyRows: value })}
          />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup title="操作项配置">
        <PropertyRow label="复制按钮">
          <PropertySwitch
            isSelected={Boolean(field.props.subformShowCopyButton)}
            onChange={(value) => update({ subformShowCopyButton: value })}
          />
        </PropertyRow>
        <PropertyRow label="删除按钮">
          <PropertySwitch
            isSelected={field.props.subformShowDeleteButton !== false}
            onChange={(value) => update({ subformShowDeleteButton: value })}
          />
        </PropertyRow>
        <PropertyRow label="按钮名称">
          <PropertyTextField
            value={field.props.subformDeleteButtonText ?? "删除"}
            onChange={(value) => update({ subformDeleteButtonText: value })}
          />
        </PropertyRow>
        <PropertyRow label="显示排序">
          <PropertySwitch
            isSelected={Boolean(field.props.subformShowSort)}
            onChange={(value) => update({ subformShowSort: value })}
          />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup title="展示样式">
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
          <PropertySwitch
            isSelected={field.props.subformShowHeader !== false}
            onChange={(value) => update({ subformShowHeader: value })}
          />
        </PropertyRow>
        <PropertyRow label="显示序号">
          <PropertySwitch
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
          <PropertyNumberField
            min={1}
            value={field.props.subformPageSize}
            onChange={(value) =>
              update({ subformPageSize: Math.max(1, value ?? 20) })
            }
          />
        </PropertyRow>
        <PropertyRow label="最大条数">
          <PropertyNumberField
            min={1}
            value={field.props.subformMaxRows}
            onChange={(value) =>
              update({ subformMaxRows: Math.max(1, value ?? 500) })
            }
          />
        </PropertyRow>
        <PropertyRow label="左侧列冻结">
          <PropertyNumberField
            min={0}
            value={field.props.subformFrozenLeftColumns}
            onChange={(value) =>
              update({ subformFrozenLeftColumns: Math.max(0, value ?? 0) })
            }
          />
        </PropertyRow>
        <PropertyRow label="操作列宽">
          <PropertyNumberField
            min={40}
            value={field.props.subformActionColumnWidth}
            onChange={(value) =>
              update({ subformActionColumnWidth: Math.max(40, value ?? 70) })
            }
          />
        </PropertyRow>
        <PropertyRow label="自定义其它列">
          <PropertySwitch
            isSelected={Boolean(field.props.subformAllowCustomColumns)}
            onChange={(value) => update({ subformAllowCustomColumns: value })}
          />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup title="合计设置">
        <PropertyRow label="启用合计">
          <PropertySwitch
            isSelected={Boolean(field.props.subformEnableTotals)}
            onChange={(value) => update({ subformEnableTotals: value })}
          />
        </PropertyRow>
      </PropertyGroup>
    </>
  );
}
