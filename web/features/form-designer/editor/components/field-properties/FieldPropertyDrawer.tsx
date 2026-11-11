/**
 * 字段属性抽屉
 * */

"use client";
import { AssociationFormProperties } from "./AssociationProperties";
import { SubformProperties } from "./SubformProperties";
import { SerialNumberProperties } from "./SerialNumberProperties";
import { MemberProperties } from "./MemberProperties";
import { PropertyButton, PropertyCodeToken, PropertyIconAction, PropertyInput, PropertyNumberField, PropertySelect, PropertySelectField, PropertySwitch, PropertyTextArea, PropertyTextField, PropertyToggle, PropertyToggleGroup } from "../property-panel/PropertyControls";
import { dateValidationOptions, getDateValidation } from "@/features/form-model/date-validation";
import { ArrowLeftToLine, ArrowUpToLine, CircleInfo, SquareLetterT, TrashBin } from "@gravity-ui/icons";

import { groupStyleOptions, groupTitleTypeOptions, separatorOrientationOptions, separatorStyleOptions, separatorVariantOptions } from "@/features/form-model/presentation-options";

import { ListBox, Tooltip } from "@heroui/react";

import type { DesignerComponentType, DesignerFieldProps } from "../CompTool";
import { isChoiceFieldType } from "../../designer-options";
import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";

import { AssociationDefaultValueEditor } from "./AssociationDefaultValueEditor";
import { MemberDefaultValueEditor } from "./MemberDefaultValueEditor";
import { DefaultValueEditor } from "./DefaultValueEditor";
import { OptionsEditor } from "./OptionsEditor";
import { CascaderDataSourceEditor } from "./CascaderDataSourceEditor";
import { PropertyGroup, PropertyPanelHeader, PropertyRow } from "../property-panel/PropertyLayout";

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
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PropertyPanelHeader
        title={
          <>
            {field.label}（{field.type}）
          </>
        }
        description={field.id}
      />

      <div className="flex flex-1 flex-col min-h-0 gap-2 overflow-y-auto">
        <PropertyGroup title="基础属性">
          <PropertyRow label="标题">
            <PropertyTextField
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
            <PropertyTextField
              value={field.props.description ?? ""}
              onChange={(value) =>
                onPropsChange(field.id, { description: value })
              }
            />
          </PropertyRow>
          {field.type === "groupContainer" ? (
            <PropertyRow label="风格">
              <PropertySelect
                aria-label="分组风格"
                fullWidth
                selectedKey={field.props.groupStyle ?? "simple"}
                onSelectionChange={(key) => {
                  const option = groupStyleOptions.find(
                    (item) => item.value === key,
                  );
                  if (option)
                    onPropsChange(field.id, { groupStyle: option.value });
                }}
              >
                <PropertySelect.Trigger>
                  <PropertySelect.Value />
                  <PropertySelect.Indicator />
                </PropertySelect.Trigger>
                <PropertySelect.Popover>
                  <ListBox>
                    {groupStyleOptions.map((option) => (
                      <ListBox.Item
                        key={option.value}
                        id={option.value}
                        textValue={option.label}
                      >
                        {option.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </PropertySelect.Popover>
              </PropertySelect>
            </PropertyRow>
          ) : null}
          {field.type === "groupContainer" ? (
            <PropertyRow label="标题变体">
              <PropertySelectField
                ariaLabel="分组标题变体"
                value={field.props.groupTitleType ?? "h4"}
                options={groupTitleTypeOptions}
                onChange={(value) => {
                  const option = groupTitleTypeOptions.find((item) => item.value === value);
                  if (option) onPropsChange(field.id, { groupTitleType: option.value });
                }}
              />
            </PropertyRow>
          ) : null}
          {field.type === "separator" ? (
            <>
              <PropertyRow label="方向">
                <PropertySelectField
                  ariaLabel="分割线方向"
                  value={field.props.orientation ?? "horizontal"}
                  options={separatorOrientationOptions}
                  onChange={(value) => {
                    const option = separatorOrientationOptions.find((item) => item.value === value);
                    if (option) onPropsChange(field.id, { orientation: option.value });
                  }}
                />
              </PropertyRow>
              <PropertyRow label="风格">
                <PropertySelectField
                  ariaLabel="分割线风格"
                  value={field.props.separatorStyle ?? "solid"}
                  options={separatorStyleOptions}
                  onChange={(value) => {
                    const option = separatorStyleOptions.find((item) => item.value === value);
                    if (option) onPropsChange(field.id, { separatorStyle: option.value });
                  }}
                />
              </PropertyRow>
              <PropertyRow label="变体">
                <PropertySelectField
                  ariaLabel="分割线变体"
                  value={field.props.separatorVariant ?? "default"}
                  options={separatorVariantOptions}
                  onChange={(value) => {
                    const option = separatorVariantOptions.find((item) => item.value === value);
                    if (option) onPropsChange(field.id, { separatorVariant: option.value });
                  }}
                />
              </PropertyRow>
            </>
          ) : null}
          {supportsPlaceholder ? (
            <PropertyRow label="占位提示">
              <PropertyTextField
                value={field.props.placeholder ?? ""}
                onChange={(value) =>
                  onPropsChange(field.id, { placeholder: value })
                }
              />
            </PropertyRow>
          ) : null}
          <PropertyRow label="状态">
            <StatusSegmented field={field} onPropsChange={onPropsChange} />
            <PropertyIconAction label="表达式" icon={<PropertyCodeToken />} />
          </PropertyRow>
          {field.type !== "groupContainer" &&
          field.type !== "separator" &&
          field.type !== "serialNumber" &&
          field.type !== "richText" ? (
            <PropertyRow label="默认值" align="start">
              {field.type === "associationFormField" ? (
                <AssociationDefaultValueEditor
                  key={`${field.id}:${field.props.associationFormId}`}
                  field={field}
                  onPropsChange={onPropsChange}
                />
              ) : field.type === "member" ? (
                <MemberDefaultValueEditor key={field.id} field={field} onPropsChange={onPropsChange} />
              ) : (
                <DefaultValueEditor
                  fields={fields}
                  field={field}
                  onPropsChange={onPropsChange}
                />
              )}
            </PropertyRow>
          ) : null}
          {supportsOptions ? (
            <PropertyRow
              label={
                <span className="inline-flex items-center gap-1">
                  选项
                  <Tooltip>
                    <Tooltip.Trigger>
                      <button
                        type="button"
                        aria-label="选项填写说明"
                        className="inline-flex items-center justify-center"
                      >
                        <CircleInfo width={14} height={14} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      每行一个选项；不写 | 时 value 与 label 一致，写成
                      label|value 时二者分开。
                    </Tooltip.Content>
                  </Tooltip>
                </span>
              }
              align="start"
            >
              <OptionsEditor
                key={field.id}
                field={field}
                onPropsChange={onPropsChange}
              />
            </PropertyRow>
          ) : null}
          {field.type === "cascader" ? (
            <PropertyRow label="数据源" align="start">
              <CascaderDataSourceEditor
                field={field}
                onPropsChange={onPropsChange}
              />
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
                <PropertySwitch
                  isSelected={Boolean(field.props.showClearButton)}
                  onChange={(value) =>
                    onPropsChange(field.id, { showClearButton: value })
                  }
                />
              </PropertyRow>
              <PropertyRow label="显示计数">
                <PropertySwitch
                  isSelected={Boolean(field.props.showCounter)}
                  onChange={(value) =>
                    onPropsChange(field.id, { showCounter: value })
                  }
                />
              </PropertyRow>
            </>
          ) : null}
        </PropertyGroup>

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
          <SerialNumberProperties
            field={field}
            fields={fields}
            onPropsChange={onPropsChange}
          />
        ) : null}

        {![
          "subform",
          "link",
          "description",
          "button",
          "groupContainer",
          "separator",
        ].includes(field.type) ? (
          <PropertyGroup title="校验">
            {field.type === "date" || field.type === "dateRange" ? (
              <PropertyRow label="日期范围" align="start">
                <PropertySelect
                  aria-label="日期范围"
                  fullWidth
                  selectedKey={getDateValidation(field.props)}
                  onSelectionChange={(key) => {
                    const selected = dateValidationOptions.find(
                      (option) => option.value === key,
                    );
                    if (selected)
                      onPropsChange(field.id, {
                        dateValidation: selected.value,
                        dateTodayOrFuture: false,
                      });
                  }}
                >
                  <PropertySelect.Trigger>
                    <PropertySelect.Value />
                    <PropertySelect.Indicator />
                  </PropertySelect.Trigger>
                  <PropertySelect.Popover>
                    <ListBox>
                      {dateValidationOptions.map((option) => (
                        <ListBox.Item
                          key={option.value}
                          id={option.value}
                          textValue={option.label}
                        >
                          {option.label}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </PropertySelect.Popover>
                </PropertySelect>
              </PropertyRow>
            ) : null}
            {field.type !== "serialNumber" ? (
              <PropertyRow label="必填">
                <PropertySwitch
                  isSelected={Boolean(field.props.isRequired)}
                  onChange={(value) =>
                    onPropsChange(field.id, { isRequired: value })
                  }
                />
              </PropertyRow>
            ) : null}
            {["singleLineText", "multiLineText", "serialNumber"].includes(
              field.type,
            ) ? (
              <PropertyRow label="去重校验">
                <PropertySwitch
                  isSelected={Boolean(field.props.isUnique)}
                  onChange={(value) =>
                    onPropsChange(field.id, { isUnique: value })
                  }
                />
              </PropertyRow>
            ) : null}
            {field.type === "singleLineText" ? (
              <PropertyRow label="格式校验">
                <PropertySwitch
                  isSelected={Boolean(field.props.formatValidation)}
                  onChange={(value) =>
                    onPropsChange(field.id, {
                      formatValidation: value ? "email" : undefined,
                    })
                  }
                />
                {field.props.formatValidation ? (
                  <PropertySelect
                    aria-label="格式校验类型"
                    className="min-w-0 flex-1"
                    selectedKey={field.props.formatValidation}
                    onSelectionChange={(key) => {
                      if (key == null) return;
                      onPropsChange(field.id, {
                        formatValidation: String(
                          key,
                        ) as DesignerFieldProps["formatValidation"],
                      });
                    }}
                  >
                    <PropertySelect.Trigger>
                      <PropertySelect.Value />
                      <PropertySelect.Indicator />
                    </PropertySelect.Trigger>
                    <PropertySelect.Popover>
                      <ListBox>
                        <ListBox.Item id="email">邮箱</ListBox.Item>
                        <ListBox.Item id="phoneCN">+86 手机号</ListBox.Item>
                        <ListBox.Item id="idCardCN">身份证</ListBox.Item>
                      </ListBox>
                    </PropertySelect.Popover>
                  </PropertySelect>
                ) : null}
              </PropertyRow>
            ) : null}
            {field.type === "number" ? (
              <>
                <PropertyRow label="最小值">
                  <PropertyNumberField
                    value={field.props.minValue}
                    onChange={(value) =>
                      onPropsChange(field.id, { minValue: value })
                    }
                  />
                </PropertyRow>
                <PropertyRow label="最大值">
                  <PropertyNumberField
                    value={field.props.maxValue}
                    onChange={(value) =>
                      onPropsChange(field.id, { maxValue: value })
                    }
                  />
                </PropertyRow>
              </>
            ) : null}
          </PropertyGroup>
        ) : null}
      </div>

      <footer>
        <PropertyButton variant="danger" fullWidth onPress={() => onDelete(field.id)}>
          <TrashBin />
          删除组件
        </PropertyButton>
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
        <PropertyTextArea
          aria-label={codeLabel}
          className="w-full"
          value={field.props.code ?? ""}
          onChange={(event) =>
            onPropsChange(field.id, { code: event.currentTarget.value })
          }
        />
      </PropertyRow>
      <PropertyRow label="外部资源来源" align="start">
        <PropertyInput
          aria-label="外部资源来源"
          className="w-full"
          placeholder="https://cdn.example.com, https://api.example.com"
          value={origins}
          onChange={(event) =>
            onPropsChange(field.id, {
              allowedResourceOrigins: event.currentTarget.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            })
          }
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
    <PropertyToggleGroup
      aria-label="标题位置"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const selected = options.find((option) => keys.has(option.value));
        if (selected) onChange(selected.value);
      }}
    >
      {options.map((option) => (
        <PropertyToggle key={option.value} id={option.value}>
          {option.value === "top" ? (
            <ArrowUpToLine aria-hidden="true" />
          ) : option.value === "left" ? (
            <ArrowLeftToLine aria-hidden="true" />
          ) : (
            <SquareLetterT aria-hidden="true" />
          )}
          {option.label}
        </PropertyToggle>
      ))}
    </PropertyToggleGroup>
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
      {field.type === "date" ? (
        <>
          <PropertyRow label="日期精度">
            <PropertySelect
              aria-label="日期精度"
              selectedKey={field.props.granularity ?? "day"}
              onSelectionChange={(key) => {
                if (key != null)
                  onPropsChange(field.id, {
                    granularity: String(
                      key,
                    ) as DesignerFieldProps["granularity"],
                  });
              }}
            >
              <PropertySelect.Trigger>
                <PropertySelect.Value />
                <PropertySelect.Indicator />
              </PropertySelect.Trigger>
              <PropertySelect.Popover>
                <ListBox>
                  <ListBox.Item id="day" textValue="日">
                    日
                  </ListBox.Item>
                  <ListBox.Item id="hour" textValue="小时">
                    小时
                  </ListBox.Item>
                  <ListBox.Item id="minute" textValue="分钟">
                    分钟
                  </ListBox.Item>
                  <ListBox.Item id="second" textValue="秒">
                    秒
                  </ListBox.Item>
                </ListBox>
              </PropertySelect.Popover>
            </PropertySelect>
          </PropertyRow>
          <PropertyRow label="小时制">
            <PropertySelect
              aria-label="小时制"
              selectedKey={String(field.props.hourCycle ?? "auto")}
              onSelectionChange={(key) => {
                if (key != null)
                  onPropsChange(field.id, {
                    hourCycle:
                      key === "auto" ? undefined : (Number(key) as 12 | 24),
                  });
              }}
            >
              <PropertySelect.Trigger>
                <PropertySelect.Value />
                <PropertySelect.Indicator />
              </PropertySelect.Trigger>
              <PropertySelect.Popover>
                <ListBox>
                  <ListBox.Item id="auto" textValue="跟随地区">
                    跟随地区
                  </ListBox.Item>
                  <ListBox.Item id="12" textValue="12 小时制">
                    12 小时制
                  </ListBox.Item>
                  <ListBox.Item id="24" textValue="24 小时制">
                    24 小时制
                  </ListBox.Item>
                </ListBox>
              </PropertySelect.Popover>
            </PropertySelect>
          </PropertyRow>
          <PropertyRow label="隐藏时区">
            <PropertySwitch
              isSelected={Boolean(field.props.hideTimeZone)}
              onChange={(hideTimeZone) =>
                onPropsChange(field.id, { hideTimeZone })
              }
            />
          </PropertyRow>
          <PropertyRow label="数字补零">
            <PropertySwitch
              isSelected={Boolean(field.props.shouldForceLeadingZeros)}
              onChange={(shouldForceLeadingZeros) =>
                onPropsChange(field.id, { shouldForceLeadingZeros })
              }
            />
          </PropertyRow>
        </>
      ) : null}
      {field.type === "link" ? (
        <>
          <PropertyRow label="链接地址">
            <PropertyTextField
              value={field.props.href ?? ""}
              onChange={(value) => onPropsChange(field.id, { href: value })}
            />
          </PropertyRow>
          <PropertyRow label="新窗口">
            <PropertySwitch
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
          <PropertyNumberField
            max={4}
            min={1}
            value={field.props.locationDepth ?? 3}
            onChange={(value) =>
              onPropsChange(field.id, {
                locationDepth: Math.min(4, Math.max(1, Math.round(value ?? 3))),
              })
            }
          />
        </PropertyRow>
      ) : null}
      {field.type === "attachment" || field.type === "imageUpload" ? (
        <>
          <PropertyRow label="按钮文字">
            <PropertyTextField
              value={field.props.buttonText ?? ""}
              onChange={(value) =>
                onPropsChange(field.id, { buttonText: value })
              }
            />
          </PropertyRow>
          <PropertyRow label="accept">
            <PropertyTextField
              value={field.props.accept ?? ""}
              onChange={(value) => onPropsChange(field.id, { accept: value })}
            />
          </PropertyRow>
          <PropertyRow label="多文件">
            <PropertySwitch
              isSelected={Boolean(field.props.multiple)}
              onChange={(value) => onPropsChange(field.id, { multiple: value })}
            />
          </PropertyRow>
          <PropertyRow label="文件大小限制 (MB)">
            <PropertyTextField
              value={String(field.props.maxFileSizeMb ?? 20)}
              onChange={(value) => {
                const size = Number(value);
                onPropsChange(field.id, {
                  maxFileSizeMb: Number.isFinite(size) && size > 0 ? size : 20,
                });
              }}
            />
          </PropertyRow>
          <PropertyRow label="显示上传限制提示">
            <PropertySwitch
              isSelected={field.props.showUploadLimitHint !== false}
              onChange={(showUploadLimitHint) =>
                onPropsChange(field.id, { showUploadLimitHint })
              }
            />
          </PropertyRow>
        </>
      ) : null}
      {field.type === "button" ? (
        <PropertyRow label="按钮文字">
          <PropertyTextField
            value={field.props.buttonText ?? ""}
            onChange={(value) => onPropsChange(field.id, { buttonText: value })}
          />
        </PropertyRow>
      ) : null}
    </>
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
  ].filter((option) => field.type !== "separator" || option.value === "normal" || option.value === "hidden");

  return (
    <PropertyToggleGroup
      aria-label="字段状态"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[current]}
      onSelectionChange={(keys) => {
        const selected = options.find((option) => keys.has(option.value));
        if (!selected) return;
        const key = selected.value;
        onPropsChange(field.id, {
          isDisabled: key === "disabled",
          isHidden: key === "hidden",
          isReadOnly: key === "readOnly",
        });
      }}
    >
      {options.map((option) => (
        <PropertyToggle key={option.value} id={option.value}>
          {option.label}
        </PropertyToggle>
      ))}
    </PropertyToggleGroup>
  );
}
