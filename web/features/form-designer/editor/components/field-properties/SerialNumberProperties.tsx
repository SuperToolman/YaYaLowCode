"use client";

import { PropertyButton, PropertyInput, PropertyNumberField, PropertySegmented, PropertySelect, PropertySwitch } from "../property-panel/PropertyControls";

import { TrashBin, PencilToSquare } from "@gravity-ui/icons";

import { useState } from "react";
import type { Key } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ListBox, Popover } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import type { DesignerFieldProps, SerialNumberRule } from "../CompTool";

import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";

import { PropertyGroup, PropertyRow } from "../property-panel/PropertyLayout";
import { MySurface } from "@/shared/ui/MySurface";

export function SerialNumberProperties({
  field,
  fields,
  onPropsChange,
}: {
  field: PlacedField;
  fields: PlacedField[];
  onPropsChange: FieldPropsChangeHandler;
}) {
  const update = (props: DesignerFieldProps) => onPropsChange(field.id, props);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const rules = getSerialNumberRules(field.props);
  const editingRule = rules.find((rule) => rule.id === editingRuleId) ?? null;
  const selectableFields = fields.filter(
    (candidate) =>
      candidate.id !== field.id &&
      candidate.type !== "groupContainer" &&
      candidate.type !== "separator" &&
      candidate.type !== "subform" &&
      candidate.type !== "description" &&
      candidate.type !== "button",
  );
  const preview = rules
    .map((rule) => serialRulePreview(rule, selectableFields))
    .join("");

  const updateRule = (ruleId: string, nextRule: SerialNumberRule) => {
    update({
      serialNumberRules: rules.map((rule) =>
        rule.id === ruleId ? nextRule : rule,
      ),
    });
  };

  const moveRule = (activeRuleId: string, targetRuleId: string) => {
    if (activeRuleId === targetRuleId) return;
    const sourceIndex = rules.findIndex((rule) => rule.id === activeRuleId);
    const targetIndex = rules.findIndex((rule) => rule.id === targetRuleId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextRules = [...rules];
    const [moved] = nextRules.splice(sourceIndex, 1);
    nextRules.splice(targetIndex, 0, moved);
    update({ serialNumberRules: nextRules });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const targetRuleId = event.over?.id;
    if (targetRuleId) moveRule(String(event.active.id), String(targetRuleId));
  };

  return (
    <>
      <PropertyGroup title="规则定义">
        <div className="space-y-1.5">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            {rules.map((rule) => (
              <SerialNumberRuleItem
                key={rule.id}
                rule={rule}
                fields={selectableFields}
                onDelete={() =>
                  update({
                    serialNumberRules: rules.filter(
                      (item) => item.id !== rule.id,
                    ),
                  })
                }
                onEdit={() => setEditingRuleId(rule.id)}
              />
            ))}
          </DndContext>
          <SerialNumberAddRulePopover
            fields={selectableFields}
            onAdd={(rule) => update({ serialNumberRules: [...rules, rule] })}
          />
        </div>
      </PropertyGroup>
      <PropertyGroup title="流水号效果预览">
        <PropertyInput
          value={preview}
          readOnly
          aria-label="流水号预览"
          className="w-full"
        />
      </PropertyGroup>
      <Modal
        isOpen={Boolean(editingRule)}
        onOpenChange={(open) => !open && setEditingRuleId(null)}
      >
        <Modal.Backdrop>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>编辑规则</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {editingRule?.type === "fixedText" ? (
                  <PropertyInput
                    aria-label="固定字符内容"
                    value={editingRule.value}
                    onChange={(event) =>
                      updateRule(editingRule.id, {
                        ...editingRule,
                        value: event.currentTarget.value,
                      })
                    }
                  />
                ) : null}
                {editingRule?.type === "submittedDate" ? (
                  <PropertySegmented
                    value={editingRule.format}
                    options={[
                      { label: "年", value: "year" },
                      { label: "年月", value: "yearMonth" },
                      { label: "年月日", value: "yearMonthDay" },
                      { label: "年月日时分", value: "yearMonthDayHourMinute" },
                      {
                        label: "年月日时分秒",
                        value: "yearMonthDayHourMinuteSecond",
                      },
                    ]}
                    onChange={(value) =>
                      updateRule(editingRule.id, {
                        ...editingRule,
                        format: value as typeof editingRule.format,
                      })
                    }
                  />
                ) : null}
                {editingRule?.type === "formField" ? (
                  <div className="space-y-2">
                    <PropertySelect
                      aria-label="表单字段"
                      selectedKey={editingRule.fieldId || null}
                      onSelectionChange={(key) =>
                        updateRule(editingRule.id, {
                          ...editingRule,
                          fieldId: key ? String(key) : "",
                        })
                      }
                    >
                      <PropertySelect.Trigger className="w-full">
                        <PropertySelect.Value>请选择字段</PropertySelect.Value>
                        <PropertySelect.Indicator />
                      </PropertySelect.Trigger>
                      <PropertySelect.Popover>
                        <ListBox>
                          {selectableFields.map((candidate) => (
                            <ListBox.Item key={candidate.id} id={candidate.id}>
                              {candidate.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </PropertySelect.Popover>
                    </PropertySelect>
                    <PropertyInput
                      aria-label="空值替代"
                      placeholder="请输入（最多10个字符）"
                      maxLength={10}
                      value={editingRule.fallback}
                      onChange={(event) =>
                        updateRule(editingRule.id, {
                          ...editingRule,
                          fallback: event.currentTarget.value,
                        })
                      }
                    />
                  </div>
                ) : null}
                {editingRule?.type === "autoCount" ? (
                  <div className="space-y-2">
                    <PropertyRow label="计数位数">
                      <PropertyNumberField
                        min={1}
                        value={editingRule.digits}
                        onChange={(value) =>
                          updateRule(editingRule.id, {
                            ...editingRule,
                            digits: Math.max(1, value ?? 4),
                          })
                        }
                      />
                    </PropertyRow>
                    <PropertyRow label="固定补零">
                      <PropertySwitch
                        isSelected={editingRule.fixedDigits}
                        onChange={(value) =>
                          updateRule(editingRule.id, {
                            ...editingRule,
                            fixedDigits: value,
                          })
                        }
                      />
                    </PropertyRow>
                    <PropertyRow label="重置周期">
                      <PropertySegmented
                        value={editingRule.resetPeriod}
                        options={[
                          { label: "不自动重置", value: "never" },
                          { label: "每天", value: "daily" },
                          { label: "每月", value: "monthly" },
                          { label: "每年", value: "yearly" },
                        ]}
                        onChange={(value) =>
                          updateRule(editingRule.id, {
                            ...editingRule,
                            resetPeriod:
                              value as typeof editingRule.resetPeriod,
                          })
                        }
                      />
                    </PropertyRow>
                    <PropertyRow label="初始值">
                      <PropertyNumberField
                        min={1}
                        value={editingRule.initialValue}
                        onChange={(value) =>
                          updateRule(editingRule.id, {
                            ...editingRule,
                            initialValue: Math.max(1, value ?? 1),
                          })
                        }
                      />
                    </PropertyRow>
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <PropertyButton onPress={() => setEditingRuleId(null)}>完成</PropertyButton>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}

function getSerialNumberRules(props: DesignerFieldProps): SerialNumberRule[] {
  if (props.serialNumberRules?.length) return props.serialNumberRules;
  return [
    {
      id: "auto-count",
      type: "autoCount",
      digits: Math.max(1, props.serialNumberDigits ?? 4),
      fixedDigits: props.serialNumberFixedDigits !== false,
      resetPeriod: props.serialNumberResetPeriod ?? "never",
      initialValue: Math.max(1, props.serialNumberInitialValue ?? 1),
    },
  ];
}

function SerialNumberRuleItem({
  rule,
  fields,
  onDelete,
  onEdit,
}: {
  rule: SerialNumberRule;
  fields: PlacedField[];
  onDelete: () => void;
  onEdit: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
  } = useDraggable({ id: rule.id });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: rule.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <MySurface
      ref={(node: HTMLElement | null) => {
        setDraggableRef(node);
        setDroppableRef(node);
      }}
      style={style}
      className="flex min-w-0 items-center "
    >
      <PropertyButton
        isIconOnly
        variant="ghost"
        aria-label="拖拽排序"
        className="touch-none"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </PropertyButton>
      <span className="min-w-0 flex-1 truncate">
        {serialRuleLabel(rule, fields)}
      </span>
      <div>
        {rule.type !== "autoCount" ? (
          <PropertyButton
            isIconOnly
            variant="ghost"
            aria-label="删除规则"
            onPress={onDelete}
          >
            <TrashBin />
          </PropertyButton>
        ) : null}
        <PropertyButton
          isIconOnly
          variant="secondary"
          aria-label="编辑规则"
          onPress={onEdit}
        >
          <PencilToSquare />
        </PropertyButton>
      </div>
    </MySurface>
  );
}

function SerialNumberAddRulePopover({
  fields,
  onAdd,
}: {
  fields: PlacedField[];
  onAdd: (rule: SerialNumberRule) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [ruleCounter, setRuleCounter] = useState(1);
  const [type, setType] = useState<"fixedText" | "submittedDate" | "formField">(
    "fixedText",
  );
  const [value, setValue] = useState("TEXT");
  const [format, setFormat] =
    useState<Extract<SerialNumberRule, { type: "submittedDate" }>["format"]>(
      "yearMonthDay",
    );
  const [fieldId, setFieldId] = useState("");
  const [fallback, setFallback] = useState("");
  const confirmAdd = () => {
    const id = `serial-rule-${type}-${ruleCounter}`;
    onAdd(
      type === "fixedText"
        ? { id, type, value }
        : type === "submittedDate"
          ? { id, type, format }
          : { id, type, fieldId, fallback },
    );
    setRuleCounter((current) => current + 1);
    setOpen(false);
  };
  return (
    <Popover isOpen={isOpen} onOpenChange={setOpen}>
      <Popover.Trigger>
        <PropertyButton variant="secondary">
          添加规则
        </PropertyButton>
      </Popover.Trigger>
      <Popover.Content className="w-72 p-0">
        <Popover.Dialog className="space-y-3 p-3">
          <Popover.Heading>添加规则</Popover.Heading>
          <PropertySegmented
            value={type}
            options={[
              { label: "固定字符", value: "fixedText" },
              { label: "提交日期", value: "submittedDate" },
              { label: "表单字段", value: "formField" },
            ]}
            onChange={(next) => setType(next as typeof type)}
          />
          {type === "fixedText" ? (
            <PropertyInput
              aria-label="固定字符"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          ) : null}
          {type === "submittedDate" ? (
            <PropertySegmented
              value={format}
              options={[
                { label: "年", value: "year" },
                { label: "年月", value: "yearMonth" },
                { label: "年月日", value: "yearMonthDay" },
                { label: "年月日时分", value: "yearMonthDayHourMinute" },
                {
                  label: "年月日时分秒",
                  value: "yearMonthDayHourMinuteSecond",
                },
              ]}
              onChange={(next) => setFormat(next as typeof format)}
            />
          ) : null}
          {type === "formField" ? (
            <div className="space-y-2">
              <PropertySelect
                aria-label="表单字段"
                selectedKey={fieldId || null}
                onSelectionChange={(key: Key | null) =>
                  setFieldId(key ? String(key) : "")
                }
              >
                <PropertySelect.Trigger className="w-full">
                  <PropertySelect.Value>
                    {fields.find((field) => field.id === fieldId)?.label ??
                      "请选择字段"}
                  </PropertySelect.Value>
                  <PropertySelect.Indicator />
                </PropertySelect.Trigger>
                <PropertySelect.Popover>
                  <ListBox>
                    {fields.map((field) => (
                      <ListBox.Item
                        key={field.id}
                        id={field.id}
                        textValue={field.label}
                      >
                        {field.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </PropertySelect.Popover>
              </PropertySelect>
              <PropertyInput
                aria-label="空值替代"
                placeholder="请输入（最多10个字符）"
                maxLength={10}
                value={fallback}
                onChange={(event) => setFallback(event.currentTarget.value)}
              />
            </div>
          ) : null}
          <div className="flex justify-end">
            <PropertyButton onPress={confirmAdd}>
              确认添加
            </PropertyButton>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function serialRuleLabel(rule: SerialNumberRule, fields: PlacedField[]) {
  if (rule.type === "autoCount") return `自动计数  ${rule.digits} 位数`;
  if (rule.type === "fixedText") return `固定字符  ${rule.value || "未设置"}`;
  if (rule.type === "submittedDate")
    return `提交日期  ${serialRulePreview(rule, fields)}`;
  return `表单字段  ${fields.find((field) => field.id === rule.fieldId)?.label ?? "未选择"}`;
}

function serialRulePreview(rule: SerialNumberRule, fields: PlacedField[]) {
  if (rule.type === "autoCount")
    return rule.fixedDigits
      ? String(rule.initialValue).padStart(rule.digits, "0")
      : String(rule.initialValue);
  if (rule.type === "fixedText") return rule.value;
  if (rule.type === "formField")
    return (
      `{${fields.find((field) => field.id === rule.fieldId)?.label ?? "字段"}}` ||
      rule.fallback
    );
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  if (rule.format === "year") return String(now.getFullYear());
  if (rule.format === "yearMonth") return date.slice(0, 6);
  if (rule.format === "yearMonthDay") return date;
  if (rule.format === "yearMonthDayHourMinute")
    return `${date}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `${date}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}
