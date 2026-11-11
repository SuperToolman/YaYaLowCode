"use client";
import { PropertyInput, PropertySwitch } from "../property-panel/PropertyControls";
import { TrashBin } from "@gravity-ui/icons";

import { FieldSelect } from "@/features/form-controls/components/FieldSelect";
import { useState } from "react";
import { Button, Table } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import type { DesignerFieldProps } from "../CompTool";
import type { PlacedField } from "../../designer-types";

import { PropertyRow } from "../property-panel/PropertyLayout";

import type { AssociationSchemaField } from "./association-types";

type AssociationFill = NonNullable<
  DesignerFieldProps["associationFills"]
>[number];

export function AssociationFillControl({
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
      <PropertySwitch
        aria-label="启用数据填充"
        isSelected={enabled}
        onChange={onEnabledChange}
        className="shrink-0"
       />
      {enabled ? (
        <PropertyInput
          aria-label="数据填充配置"
          readOnly
          value={summary}
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1"
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
      <Modal.Backdrop isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>数据填充</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <p>
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
                <section>
                  <header>
                    <h3>子表填充规则</h3>
                    <Button onPress={addChildRule}>
                      新增子表规则
                    </Button>
                  </header>
                  {childRules.length === 0 ? (
                    <p>未配置子表填充规则</p>
                  ) : (
                    <div>
                      {childRules.map((rule, index) => {
                        const sourceFields = sourceSchemaFields.filter(
                          (item) =>
                            item.parentGroupId === rule.sourceSubformId &&
                            ![
                              "groupContainer",
                              "separator",
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
                          <section
                            key={`${rule.sourceSubformId}-${rule.targetSubformId}-${index}`}
                          >
                            <div>
                                <AssociationFillSelect
                                  ariaLabel="关联表单子表"
                                  label="关联表单子表"
                                  fields={sourceSubforms}
                                  value={rule.sourceSubformId}
                                  onChange={(sourceSubformId) =>
                                    updateChildRule(index, {
                                      sourceSubformId,
                                      mappings: [
                                        {
                                          sourceFieldId: "",
                                          targetFieldId: "",
                                        },
                                      ],
                                    })
                                  }
                                />
                                <AssociationFillSelect
                                  ariaLabel="当前表单子表"
                                  label="当前表单子表"
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
                                        {
                                          sourceFieldId: "",
                                          targetFieldId: "",
                                        },
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
                          </section>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={() => onChange(false)}>取消</Button>
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
    <section>
      <header>
        <h3>{title}</h3>
        <Button onPress={onAdd}>新增字段映射</Button>
      </header>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label={title}>
            <Table.Header>
              <Table.Column id="sourceField" isRowHeader>
                字段名称
              </Table.Column>
              <Table.Column id="direction">填充到</Table.Column>
              <Table.Column id="targetField">字段名称</Table.Column>
              <Table.Column id="actions">操作</Table.Column>
            </Table.Header>
            <Table.Body>
              {rules.map((rule, index) => (
                <Table.Row
                  key={`${index}-${rule.sourceFieldId}-${rule.targetFieldId}`}
                  id={`${title}-${index}`}
                >
                  <Table.Cell>
                    <AssociationFillSelect
                      ariaLabel="关联字段"
                      fields={sourceFields}
                      value={rule.sourceFieldId}
                      onChange={(sourceFieldId) =>
                        onChange(index, { sourceFieldId })
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>填充到</Table.Cell>
                  <Table.Cell>
                    <AssociationFillSelect
                      ariaLabel="当前字段"
                      fields={targetFields}
                      value={rule.targetFieldId}
                      onChange={(targetFieldId) =>
                        onChange(index, { targetFieldId })
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      aria-label="删除映射"
                      variant="ghost"
                      isIconOnly
                      isDisabled={rules.length === 1}
                      onPress={() => onRemove(index)}
                    >
                      <TrashBin />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </section>
  );
}

function AssociationFillSelect({
  ariaLabel,
  fields,
  label,
  onChange,
  placeholder = "字段名称",
  value,
}: {
  ariaLabel: string;
  fields: AssociationSchemaField[];
  label?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <FieldSelect
      ariaLabel={ariaLabel}
      label={label}
      placeholder={placeholder}
      isDisabled={fields.length === 0}
      options={fields.map((field) => ({
        key: field.id,
        label: field.label,
        fieldType: field.type,
      }))}
      value={value}
      onChange={onChange}
    />
  );
}
