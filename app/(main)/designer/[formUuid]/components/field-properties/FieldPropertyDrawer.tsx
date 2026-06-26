/**
 * 字段属性抽屉
 * */

"use client";

import { Button } from "@heroui/react";
import { Drawer } from "@heroui/react/drawer";
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

type FieldPropertyDrawerProps = {
  fields: PlacedField[];
  field: PlacedField | null;
  isOpen: boolean;
  onDelete: (fieldId: string) => void;
  onLabelChange: (fieldId: string, label: string) => void;
  onOpenChange: (isOpen: boolean) => void;
  onPropsChange: FieldPropsChangeHandler;
};

export function FieldPropertyDrawer({
  fields,
  field,
  isOpen,
  onDelete,
  onLabelChange,
  onOpenChange,
  onPropsChange,
}: FieldPropertyDrawerProps) {
  if (!field) {
    return null;
  }

  const supportsPlaceholder = PLACEHOLDER_FIELD_TYPES.has(field.type);
  const supportsCounter = COUNTER_FIELD_TYPES.has(field.type);
  const supportsOptions = isChoiceFieldType(field.type);

  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop className="bg-[#14213d]/10" isDismissable>
        <Drawer.Content placement="right" className="designer-properties-drawer">
          <Drawer.Dialog className="flex h-full w-full flex-col bg-white text-[#202f45] shadow-[0_30px_80px_rgba(20,33,61,0.18)]">
            <Drawer.Header className="border-b border-[#eef2f7] px-0 py-0">
              <Drawer.Heading className="sr-only">组件属性</Drawer.Heading>
              <div className="relative grid h-10 grid-cols-2 text-sm">
                <Button
                  type="button"
                  className="relative font-medium text-[#1d2d44]"
                >
                  属性
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-[#2f6bff]" />
                </Button>
                <Button type="button" className="text-[#66758c]">
                  高级
                </Button>
                <Drawer.CloseTrigger
                  aria-label="关闭属性栏"
                  className="absolute right-1 top-1"
                />
              </div>
            </Drawer.Header>

            <Drawer.Body className="flex-1 overflow-y-auto px-0 py-0">
              <div className="py-2">
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
                  <PropertyRow label="默认值" align="start">
                    <DefaultValueEditor
                      fields={fields}
                      field={field}
                      onPropsChange={onPropsChange}
                    />
                  </PropertyRow>
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
            </Drawer.Body>

            <Drawer.Footer className="border-t border-[#eef2f7] px-3 py-3">
              <Button
                fullWidth
                variant="ghost"
                onPress={() => onDelete(field.id)}
                className="text-[#d14343]"
              >
                删除组件
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
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
    <div className="flex h-8 flex-1 rounded-lg bg-[#f1f3f6] p-0.5">
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
            "flex-1 rounded-md px-2 text-xs transition",
            current === option.value
              ? "bg-white text-[#202f45] shadow-sm"
              : "text-[#66758c]",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
