"use client";

import type { ReactNode } from "react";
import { Button, ListBox, Select } from "@heroui/react";
import { Plus as AddIcon, TrashBin as TrashIcon } from "@gravity-ui/icons";
import type { AutomationFormulaField } from "../../components/AutomationFormulaEditorModal";
import { fieldTypeMatches, valueTypeLabel } from "../automation-editor-model";
import type { FieldMappingRow, FormFieldDescriptor } from "@/features/automation-editor/field-mapping";
import {
  FieldSelect,
  FieldValueInput,
  MappingFormulaInput,
  PropertyPanelSection,
  SourceFieldSelect,
} from "./AutomationNodeConfigPrimitives";
import { MyShip } from "@/components/ui/MyShip";

export function MappingRowsEditor({
  children,
  title = "字段设置",
  lockRequiredRows = true,
  rows,
  sourceFieldChoices,
  targetFields,
  onAddMappingRow,
  onRemoveMappingRow,
  onRowChange,
}: {
  children?: ReactNode;
  title?: string;
  lockRequiredRows?: boolean;
  rows: FieldMappingRow[];
  sourceFieldChoices: AutomationFormulaField[];
  targetFields: FormFieldDescriptor[];
  onAddMappingRow: () => void;
  onRemoveMappingRow: (rowId: string) => void;
  onRowChange: (
    rowId: string,
    key: keyof FieldMappingRow,
    value: string,
  ) => void;
}) {
  return (
    <PropertyPanelSection
      title={title}
      description={lockRequiredRows
              ? "必填字段会自动带出并禁止删除，新增字段按目标表单字段选择。"
              : "选择需要更新的目标字段并配置写入值。"}
      actions={
        <Button
          size="sm"
          onPress={onAddMappingRow}
          isDisabled={
            targetFields.length === 0 || rows.length >= targetFields.length
          }
        >
          <AddIcon />
          添加字段
        </Button>
      }
    >
      {children}
      {rows.length > 0 ? (
        <div className="overflow-x-auto" role="group" aria-label="字段配置">
          <div className="grid grid-cols-[max-content_max-content_minmax(130px,1fr)_max-content] items-center gap-x-2 gap-y-2 py-1">
                <div className="whitespace-nowrap">目标字段</div>
                <div className="whitespace-nowrap">字段类型</div>
                <div>字段值</div>
                <div><span className="sr-only">操作</span></div>
                {rows.map((row) => {
                  const targetField = targetFields.find(
                    (field) => field.id === row.fieldId,
                  );
                  const usedFieldIds = new Set(
                    rows
                      .filter((item) => item.id !== row.id)
                      .map((item) => item.fieldId),
                  );
                  const availableFields = targetFields.filter(
                    (field) =>
                      !usedFieldIds.has(field.id) || field.id === row.fieldId,
                  );
                  const changeField = (value: string) => {
                    if (!value || !usedFieldIds.has(value))
                      onRowChange(row.id, "fieldId", value);
                  };
                  const matchingSourceFields = sourceFieldChoices.filter(
                    (item) =>
                      fieldTypeMatches(item.fieldType, targetField?.type),
                  );
                  return (
                    <div key={row.id} className="contents">
                      <div className="whitespace-nowrap [&_[data-slot=select-trigger]]:w-max [&_[data-slot=select-value]]:whitespace-nowrap">
                        <FieldSelect
                          isDisabled={lockRequiredRows && Boolean(targetField?.isRequired)}
                          fields={availableFields}
                          value={row.fieldId}
                          onChange={changeField}
                        />
                      </div>
                      <div className="whitespace-nowrap [&_[data-slot=select-trigger]]:w-max [&_[data-slot=select-value]]:whitespace-nowrap">
                        <Select
                          aria-label="字段值类型"
                          fullWidth
                          selectedKey={row.valueType}
                          onSelectionChange={(key) =>
                            onRowChange(
                              row.id,
                              "valueType",
                              String(key ?? "value"),
                            )
                          }
                        >
                          <Select.Trigger>
                            <Select.Value>
                              {valueTypeLabel(row.valueType)}
                            </Select.Value>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="value" textValue="值">
                                值
                              </ListBox.Item>
                              <ListBox.Item id="field" textValue="字段">
                                字段
                              </ListBox.Item>
                              <ListBox.Item id="formula" textValue="公式">
                                公式
                              </ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>
                      <div className="min-w-0">
                        {row.valueType === "value" ? (
                          <FieldValueInput
                            field={targetField}
                            value={row.rawValue ?? ""}
                            onChange={(value) =>
                              onRowChange(row.id, "rawValue", value)
                            }
                          />
                        ) : null}
                        {row.valueType === "field" ? (
                          <SourceFieldSelect
                            options={matchingSourceFields}
                            value={row.sourceFieldKey ?? ""}
                            onChange={(value) =>
                              onRowChange(row.id, "sourceFieldKey", value)
                            }
                          />
                        ) : null}
                        {row.valueType === "formula" ? (
                          <MappingFormulaInput
                            fields={sourceFieldChoices}
                            fieldLabel={targetField?.label ?? "字段值"}
                            value={row.formula ?? ""}
                            onChange={(value) =>
                              onRowChange(row.id, "formula", value)
                            }
                          />
                        ) : null}
                      </div>
                      <div className="whitespace-nowrap">
                        <Button
                          isIconOnly
                          variant="danger"
                          aria-label={
                            lockRequiredRows && targetField?.isRequired
                              ? "必填字段不可删除"
                              : "删除字段映射"
                          }
                          onClick={() => onRemoveMappingRow(row.id)}
                          isDisabled={
                            lockRequiredRows && Boolean(targetField?.isRequired)
                          }
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      ) : (
        <MyShip content="选择目标表单后会自动带出必填字段，也可以继续添加更多字段映射。" />
      )}
    </PropertyPanelSection>
  );
}
