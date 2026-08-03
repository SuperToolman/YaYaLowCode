"use client";

import { Button, ListBox, Select } from "@heroui/react";
import { AddIcon, TrashIcon } from "../../../../components/app-icons";
import type { AutomationFormulaField } from "../automation-formula-editor-modal";
import {
  fieldTypeMatches,
  valueTypeLabel,
  type FieldMappingRow,
  type FormFieldDescriptor,
} from "./automation-editor-model";
import {
  FieldSelect,
  FieldValueInput,
  MappingFormulaInput,
  PropertyPanelSection,
  SourceFieldSelect,
} from "./automation-node-config-primitives";

export function MappingRowsEditor({
  lockRequiredRows = true,
  rows,
  sourceFieldChoices,
  targetFields,
  onAddMappingRow,
  onRemoveMappingRow,
  onRowChange,
}: {
  lockRequiredRows?: boolean;
  rows: FieldMappingRow[];
  sourceFieldChoices: AutomationFormulaField[];
  targetFields: FormFieldDescriptor[];
  onAddMappingRow: () => void;
  onRemoveMappingRow: (rowId: string) => void;
  onRowChange: (rowId: string, key: keyof FieldMappingRow, value: string) => void;
}) {
  return (
    <PropertyPanelSection
      title="字段设置"
      description="必填字段会自动带出并禁止删除，新增字段按目标表单字段选择。"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs leading-5 text-[var(--color-text-secondary)]">
          根据目标表单字段配置写入值。
        </div>
        <Button
          className="h-8 rounded-md bg-[var(--color-primary)] px-3 text-[var(--color-text-on-primary)]"
          onClick={onAddMappingRow}
          isDisabled={targetFields.length === 0 || rows.length >= targetFields.length}
        >
          <AddIcon />
          添加字段
        </Button>
      </div>

      {rows.length > 0 ? (
        <div className="space-y-3">
          <div className="hidden grid-cols-[92px_64px_minmax(0,1fr)_32px] gap-2 px-1 text-xs font-medium text-[var(--color-text-secondary)] md:grid">
            <div>目标字段</div>
            <div>字段类型</div>
            <div>字段值</div>
            <div />
          </div>
          {rows.map((row) => {
            const targetField = targetFields.find((field) => field.id === row.fieldId);
            const matchingSourceFields = sourceFieldChoices.filter((item) =>
              fieldTypeMatches(item.fieldType, targetField?.type),
            );
            return (
              <div
                key={row.id}
                className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-1 md:grid-cols-[92px_64px_minmax(0,1fr)_32px] md:items-center"
              >
                <FieldSelect
                  fields={targetFields}
                  value={row.fieldId}
                  onChange={(value) => onRowChange(row.id, "fieldId", value)}
                />
                <Select
                  aria-label="字段值类型"
                  fullWidth
                  className="min-w-0"
                  selectedKey={row.valueType}
                  onSelectionChange={(key) =>
                    onRowChange(row.id, "valueType", String(key ?? "value"))
                  }
                >
                  <Select.Trigger>
                    <Select.Value>{valueTypeLabel(row.valueType)}</Select.Value>
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
                <div className="min-w-0 w-full">
                  {row.valueType === "value" ? (
                    <FieldValueInput
                      field={targetField}
                      value={row.rawValue ?? ""}
                      onChange={(value) => onRowChange(row.id, "rawValue", value)}
                    />
                  ) : null}
                  {row.valueType === "field" ? (
                    <SourceFieldSelect
                      options={matchingSourceFields}
                      value={row.sourceFieldKey ?? ""}
                      onChange={(value) => onRowChange(row.id, "sourceFieldKey", value)}
                    />
                  ) : null}
                  {row.valueType === "formula" ? (
                    <MappingFormulaInput
                      fields={sourceFieldChoices}
                      fieldLabel={targetField?.label ?? "字段值"}
                      value={row.formula ?? ""}
                      onChange={(value) => onRowChange(row.id, "formula", value)}
                    />
                  ) : null}
                </div>
                <Button
                  isIconOnly
                  aria-label={lockRequiredRows && targetField?.isRequired ? "必填字段不可删除" : "删除字段映射"}
                  variant="ghost"
                  className="h-8 min-h-8 w-8 min-w-8 justify-self-center rounded-md border border-transparent p-0 text-[var(--color-danger)] hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:text-[var(--color-text-disabled)]"
                  onClick={() => onRemoveMappingRow(row.id)}
                  isDisabled={lockRequiredRows && Boolean(targetField?.isRequired)}
                >
                  <TrashIcon />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-5 text-sm text-[var(--color-text-secondary)]">
          选择目标表单后会自动带出必填字段，也可以继续添加更多字段映射。
        </div>
      )}
    </PropertyPanelSection>
  );
}

