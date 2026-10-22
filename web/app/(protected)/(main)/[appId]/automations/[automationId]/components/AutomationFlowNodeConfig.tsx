"use client";

import { ListBox, Select } from "@heroui/react";
import type { TriggerEvent } from "../../components/AutomationShared";
import {
  hasUpdateTriggerEvent,
  normalizeAssigneeConfig,
  normalizeCopyConfig,
  normalizeTriggerConfig,
  type FormFieldDescriptor,
  type MemberOption,
  type RoleOption,
  type WorkflowNode,
} from "../automation-editor-model";
import {
  PropertyField,
  PropertyPanelSection,
} from "./AutomationNodeConfigPrimitives";
import { MemberMultiSelect } from "@shared/MemberMultiSelect";
import { RoleMultiSelect } from "@shared/RoleMultiSelect";

export function FlowNodeConfig({
  members,
  roles,
  node,
  onBasicChange,
  onProcessMemberIdsChange,
  onProcessRequiredFieldIdsChange,
  triggerEvents,
  triggerFieldOptions,
}: {
  members: MemberOption[];
  roles: RoleOption[];
  node: WorkflowNode;
  onBasicChange: (key: string, value: string) => void;
  onProcessMemberIdsChange: (
    key: "assigneeIds" | "recipientIds" | "roleIds",
    ids: string[],
  ) => void;
  onProcessRequiredFieldIdsChange: (ids: string[]) => void;
  triggerEvents: TriggerEvent[];
  triggerFieldOptions: FormFieldDescriptor[];
}) {
  if (node.data.kind === "executor") {
    const config = normalizeAssigneeConfig(node.data.config);
    const fields = triggerFieldOptions.filter(
      (field) =>
        !["description", "button", "html", "tsx", "groupContainer"].includes(
          field.type,
        ),
    );
    return (
      <PropertyPanelSection
        title="执行配置"
        description="执行人补填表单后完成任务并流转。"
      >
        <PropertyField label="配置范围">
          <AssigneeRangeSelect
            value={config.assigneeMode === "roles" ? "roles" : "members"}
            onChange={(mode) => onBasicChange("assigneeMode", mode)}
          />
        </PropertyField>
        {config.assigneeMode === "roles" ? (
          <PropertyField label="执行角色">
            <RoleMultiSelect
              options={roles.map((role) => ({
                id: role.id,
                label: role.name,
                sourceType: role.sourceType,
                searchText: `${role.status} ${role.sourceType}`,
              }))}
              value={config.roleIds ?? []}
              onChange={(ids) => onProcessMemberIdsChange("roleIds", ids)}
            />
          </PropertyField>
        ) : (
          <PropertyField label="执行人">
            <MemberMultiSelect
              options={members.map((member) => ({
                id: member.id,
                label: member.displayName,
                sourceType: member.sourceType,
                avatarUrl: member.avatarUrl,
                searchText: `${member.status} ${member.sourceType}`,
              }))}
              value={config.assigneeIds ?? []}
              onChange={(ids) => onProcessMemberIdsChange("assigneeIds", ids)}
            />
          </PropertyField>
        )}
        <PropertyField label="完成本节点前必填">
          <Select
            selectionMode="multiple"
            value={config.requiredFieldIds ?? []}
            onChange={(keys) =>
              onProcessRequiredFieldIdsChange(keys.map(String))
            }
            shouldCloseOnSelect={false}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
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
            </Select.Popover>
          </Select>
        </PropertyField>
      </PropertyPanelSection>
    );
  }
  if (node.data.kind === "approval") {
    const config = normalizeAssigneeConfig(node.data.config);
    return (
      <PropertyPanelSection
        title="审批配置"
        description="设置审批人的范围和多人处理规则。"
      >
        <PropertyField label="配置范围">
          <AssigneeRangeSelect
            value={config.assigneeMode ?? "members"}
            onChange={(mode) => onBasicChange("assigneeMode", mode)}
            includeSelf
          />
        </PropertyField>
        {config.assigneeMode === "members" ? (
          <PropertyField label="审批成员">
            <MemberMultiSelect
              options={members.map((member) => ({
                id: member.id,
                label: member.displayName,
                sourceType: member.sourceType,
                avatarUrl: member.avatarUrl,
                searchText: `${member.status} ${member.sourceType}`,
              }))}
              value={config.assigneeIds ?? []}
              onChange={(ids) => onProcessMemberIdsChange("assigneeIds", ids)}
            />
          </PropertyField>
        ) : null}
        {config.assigneeMode === "roles" ? (
          <PropertyField label="审批角色">
            <RoleMultiSelect
              options={roles.map((role) => ({
                id: role.id,
                label: role.name,
                sourceType: role.sourceType,
                searchText: `${role.status} ${role.sourceType}`,
              }))}
              value={config.roleIds ?? []}
              onChange={(ids) => onProcessMemberIdsChange("roleIds", ids)}
            />
          </PropertyField>
        ) : null}
        {config.assigneeMode !== "self" ? (
          <PropertyField label="多人处理">
            <Select
              selectedKey={config.approvalMode ?? "all"}
              onSelectionChange={(key) =>
                onBasicChange("approvalMode", String(key))
              }
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all" textValue="全部同意">
                    全部同意
                  </ListBox.Item>
                  <ListBox.Item id="any" textValue="任一同意">
                    任一同意
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </PropertyField>
        ) : null}
      </PropertyPanelSection>
    );
  }
  if (node.data.kind === "copy") {
    const config = normalizeCopyConfig(node.data.config);
    return (
      <PropertyPanelSection
        title="抄送配置"
        description="流程经过此节点时会通知指定成员或角色。"
      >
        <PropertyField label="配置范围">
          <AssigneeRangeSelect
            value={config.recipientMode ?? "members"}
            onChange={(mode) => onBasicChange("recipientMode", mode)}
          />
        </PropertyField>
        {config.recipientMode === "roles" ? (
          <PropertyField label="抄送角色">
            <RoleMultiSelect
              options={roles.map((role) => ({
                id: role.id,
                label: role.name,
                sourceType: role.sourceType,
                searchText: `${role.status} ${role.sourceType}`,
              }))}
              value={config.roleIds ?? []}
              onChange={(ids) => onProcessMemberIdsChange("roleIds", ids)}
            />
          </PropertyField>
        ) : (
          <PropertyField label="抄送成员">
            <MemberMultiSelect
              options={members.map((member) => ({
                id: member.id,
                label: member.displayName,
                sourceType: member.sourceType,
                avatarUrl: member.avatarUrl,
                searchText: `${member.status} ${member.sourceType}`,
              }))}
              value={config.recipientIds ?? []}
              onChange={(ids) => onProcessMemberIdsChange("recipientIds", ids)}
            />
          </PropertyField>
        )}
      </PropertyPanelSection>
    );
  }
  if (node.data.kind === "trigger") {
    const config = normalizeTriggerConfig(node.data.config);
    return hasUpdateTriggerEvent(triggerEvents) ? (
      <PropertyPanelSection
        title="触发字段"
        description="仅编辑事件支持按单字段触发。"
      >
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
                {config.changedFieldMode === "specific"
                  ? "指定字段"
                  : "任意字段"}
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="any" textValue="任意字段">
                  任意字段
                </ListBox.Item>
                <ListBox.Item id="specific" textValue="指定字段">
                  指定字段
                </ListBox.Item>
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
                onBasicChange(
                  "changedFieldId",
                  String(key === "none" ? "" : (key ?? "")),
                )
              }
            >
              <Select.Trigger>
                <Select.Value>
                  {triggerFieldOptions.find(
                    (field) => field.id === config.changedFieldId,
                  )?.label ?? "选择字段"}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="none" textValue="选择字段">
                    选择字段
                  </ListBox.Item>
                  {triggerFieldOptions.map((field) => (
                    <ListBox.Item
                      key={field.id}
                      id={field.id}
                      textValue={field.label}
                    >
                      {field.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </PropertyField>
        ) : null}
      </PropertyPanelSection>
    ) : null;
  }

  function AssigneeRangeSelect({
    value,
    onChange,
    includeSelf = false,
  }: {
    value: "members" | "roles" | "self";
    onChange: (value: "members" | "roles" | "self") => void;
    includeSelf?: boolean;
  }) {
    return (
      <Select
        aria-label="配置范围"
        selectedKey={value}
        onSelectionChange={(key) =>
          onChange(String(key ?? "members") as "members" | "roles" | "self")
        }
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="members" textValue="指定成员">
              指定成员
            </ListBox.Item>
            <ListBox.Item id="roles" textValue="指定角色">
              指定角色
            </ListBox.Item>
            {includeSelf ? (
              <ListBox.Item id="self" textValue="发起人本人">
                发起人本人
              </ListBox.Item>
            ) : null}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  return null;
}
