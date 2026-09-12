"use client";

import { ListBox, Select } from "@heroui/react";
import type { TriggerEvent } from "../components/AutomationShared";
import {
  hasUpdateTriggerEvent,
  normalizeAssigneeConfig,
  normalizeCopyConfig,
  normalizeTriggerConfig,
  type FormFieldDescriptor,
  type MemberOption,
  type WorkflowNode,
} from "./automation-editor-model";
import { PropertyField, PropertyPanelSection } from "./AutomationNodeConfigPrimitives";

export function FlowNodeConfig({
  members,
  node,
  onBasicChange,
  onProcessMemberIdsChange,
  triggerEvents,
  triggerFieldOptions,
}: {
  members: MemberOption[];
  node: WorkflowNode;
  onBasicChange: (key: string, value: string) => void;
  onProcessMemberIdsChange: (key: "assigneeIds" | "recipientIds", ids: string[]) => void;
  triggerEvents: TriggerEvent[];
  triggerFieldOptions: FormFieldDescriptor[];
}) {
if (node.data.kind === "approval" || node.data.kind === "executor") {
  const config = normalizeAssigneeConfig(node.data.config);
  return <PropertyPanelSection title={node.data.kind === "approval" ? "审批配置" : "执行配置"} description="选择系统成员，配置保存为稳定用户 ID。"><PropertyField label={node.data.kind === "approval" ? "审批人" : "执行人"}><Select selectionMode="multiple" value={config.assigneeIds ?? config.assignees ?? []} onChange={(keys) => onProcessMemberIdsChange("assigneeIds", keys.map(String))} shouldCloseOnSelect={false}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox>{members.map((member) => <ListBox.Item key={member.id} id={member.id} textValue={member.displayName}>{member.displayName}</ListBox.Item>)}</ListBox></Select.Popover></Select></PropertyField>{node.data.kind === "approval" ? <PropertyField label="多人处理"><Select selectedKey={config.approvalMode ?? "all"} onSelectionChange={(key) => onBasicChange("approvalMode", String(key))}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="all" textValue="全部同意">全部同意</ListBox.Item><ListBox.Item id="any" textValue="任一同意">任一同意</ListBox.Item></ListBox></Select.Popover></Select></PropertyField> : null}</PropertyPanelSection>;
}
if (node.data.kind === "copy") {
  const config = normalizeCopyConfig(node.data.config);
  return <PropertyPanelSection title="抄送配置" description="流程经过此节点时会通知指定人员。"><PropertyField label="抄送人"><Select selectionMode="multiple" value={config.recipientIds ?? config.recipients ?? []} onChange={(keys) => onProcessMemberIdsChange("recipientIds", keys.map(String))} shouldCloseOnSelect={false}><Select.Trigger><Select.Value /></Select.Trigger><Select.Popover><ListBox>{members.map((member) => <ListBox.Item key={member.id} id={member.id} textValue={member.displayName}>{member.displayName}</ListBox.Item>)}</ListBox></Select.Popover></Select></PropertyField></PropertyPanelSection>;
}
if (node.data.kind === "end") return <PropertyPanelSection title="流程结束" description="流程到达此节点后，审批状态将更新为审核通过。" />;

if (node.data.kind === "trigger") {
  const config = normalizeTriggerConfig(node.data.config);
  return (
    hasUpdateTriggerEvent(triggerEvents) ? (
      <PropertyPanelSection title="触发字段" description="仅编辑事件支持按单字段触发。">
        <PropertyField label="触发范围">
          <Select
            aria-label="编辑触发范围"
            selectedKey={config.changedFieldMode ?? "any"}
            onSelectionChange={(key) =>
              onBasicChange("changedFieldMode", String(key ?? "any"))
            }
          >
            <Select.Trigger>
              <Select.Value>
                {config.changedFieldMode === "specific" ? "指定字段" : "任意字段"}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="any" textValue="任意字段">
                  任意字段
                </ListBox.Item>
                <ListBox.Item id="specific" textValue="指定字段">指定字段</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </PropertyField>
        {config.changedFieldMode === "specific" ? (
          <PropertyField label="指定字段">
            <Select
              aria-label="指定触发字段"
              selectedKey={config.changedFieldId || "none"}
              onSelectionChange={(key) =>
                onBasicChange("changedFieldId", String(key === "none" ? "" : key ?? ""))
              }
            >
              <Select.Trigger>
                <Select.Value>
                  {triggerFieldOptions.find((field) => field.id === config.changedFieldId)?.label ?? "选择字段"}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="none" textValue="选择字段">选择字段</ListBox.Item>
                  {triggerFieldOptions.map((field) => (
                    <ListBox.Item key={field.id} id={field.id} textValue={field.label}>{field.label}</ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </PropertyField>
        ) : null}
      </PropertyPanelSection>
    ) : null
  );
}


  return null;
}
