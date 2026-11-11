"use client";

import { buildSubformParentOptions, getSourceFormUuid, getSchemaForNodeTarget, getNodeMappingTargetFields, normalizeActionConfig, normalizeAddDataConfig, normalizeAssigneeConfig, normalizeConditionConfig, changeConditionEntryMode, normalizeCopyConfig, normalizeGetDataConfig, syncRequiredRows, type BranchRule, type FieldMappingRow } from "@/features/automation-editor/model/automation-editor-model";
import type { ActionConfig, AddDataConfig, ConditionBranch, DataSourceMode, FlowState, FormSchemaDescriptor, TriggerConfig, WorkflowEdge, WorkflowNode, WorkflowNodeConfig } from "@/features/automation-editor/model/editor-types";
import { addMappingRow, removeMappingRow, updateMappingRow } from "@/features/automation-editor/field-mapping";
import { addRule, removeRuleTree, updateRule } from "@/features/conditions";
import type { Dispatch, SetStateAction } from "react";

type NodeConfigActionsOptions = {
 selectedNodeId: string | null;
 selectedNode: WorkflowNode | null;
 setNodes: Dispatch<SetStateAction<WorkflowNode[]>>;
 nodes: WorkflowNode[];
 edges: WorkflowEdge[];
 formSchemas: Record<string, FormSchemaDescriptor>;
 flowState: FlowState;
 ensureFormSchema: (formUuid: string) => Promise<unknown>;
 handleTriggerConfigChange: (key: keyof TriggerConfig, value: string) => void;
};

export function useNodeConfigActions({ selectedNodeId, selectedNode, setNodes, nodes, edges, formSchemas, flowState, ensureFormSchema, handleTriggerConfigChange }: NodeConfigActionsOptions) {
  function handleNodeLabelChange(key: "label" | "description", value: string) {
    if (!selectedNodeId) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                [key]: value,
              },
            }
          : node,
      ),
    );
  }

  function updateSelectedNodeConfig(
    updater: (config: WorkflowNodeConfig) => WorkflowNodeConfig,
  ) {
    if (!selectedNodeId) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                config: updater(node.data.config),
              },
            }
          : node,
      ),
    );
  }

  function handleBasicNodeConfigChange(key: string, value: string) {
    if (!selectedNode) {
      return;
    }

    if (selectedNode.data.kind === "trigger") {
      handleTriggerConfigChange(key as keyof TriggerConfig, value);
      return;
    }
    if (
      key === "assigneeMode" &&
      (selectedNode.data.kind === "approval" ||
        selectedNode.data.kind === "executor")
    ) {
      updateSelectedNodeConfig((config) => ({
        ...normalizeAssigneeConfig(config),
        assigneeMode: value as "self" | "members" | "roles",
        assigneeIds: [],
        roleIds: [],
        ...(value === "self"
          ? { approvalMode: undefined }
          : { approvalMode: "all" }),
      }));
      return;
    }
    if (key === "recipientMode" && selectedNode.data.kind === "copy") {
      updateSelectedNodeConfig((config) => ({
        ...normalizeCopyConfig(config),
        recipientMode: value as "members" | "roles",
        recipientIds: [],
        roleIds: [],
      }));
      return;
    }

    updateSelectedNodeConfig((config) => ({
      ...config,
      [key]: value,
    }));
  }

  function handleProcessMemberIdsChange(
    key: "assigneeIds" | "recipientIds" | "roleIds",
    ids: string[],
  ) {
    updateSelectedNodeConfig((config) => {
      if (key === "assigneeIds") {
        return {
          ...config,
          assigneeMode: "members",
          assigneeIds: ids,
          roleIds: [],
        };
      }
      if (key === "roleIds") {
        return {
          ...config,
          roleIds: ids,
          ...(selectedNode?.data.kind === "copy"
            ? { recipientMode: "roles" }
            : { assigneeMode: "roles", assigneeIds: [] }),
        };
      }
      return {
        ...config,
        [key]: ids,
        ...(selectedNode?.data.kind === "copy"
          ? { recipientMode: "members" }
          : {}),
      };
    });
  }

  function handleGetNodeSourceModeChange(value: DataSourceMode) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeGetDataConfig(config);
      nextConfig.sourceMode = value;
      nextConfig.rules = [];
      nextConfig.formUuid = value === "form" ? nextConfig.formUuid : "";
      nextConfig.dataNodeId =
        value === "data-node" ? nextConfig.dataNodeId : "";
      return nextConfig;
    });
  }

  function handleGetNodeFormChange(formUuid: string) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeGetDataConfig(config);
      nextConfig.formUuid = formUuid;
      nextConfig.rules = [];
      return nextConfig;
    });
    if (formUuid) {
      void ensureFormSchema(formUuid);
    }
  }

  function handleGetNodeSourceNodeChange(nodeId: string) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeGetDataConfig(config);
      nextConfig.dataNodeId = nodeId;
      nextConfig.rules = [];
      return nextConfig;
    });
  }

  function handleActionTargetFormChange(formUuid: string) {
    updateSelectedNodeConfig((config) => {
      if (selectedNode?.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(config);
        nextConfig.targetFormUuid = formUuid;
        nextConfig.subformFieldId = "";
        nextConfig.parentDataNodeId = "";
        if (nextConfig.targetMode === "subtable") nextConfig.rows = [];
        const targetNode = { ...selectedNode!, data: { ...selectedNode!.data, config: nextConfig } };
        if (getSchemaForNodeTarget(targetNode, formSchemas)) {
          const targetFields = getNodeMappingTargetFields(targetNode, formSchemas);
          const targetFieldIds = new Set(targetFields.map((field) => field.id));
          nextConfig.rows = syncRequiredRows((nextConfig.rows ?? []).filter((row) => targetFieldIds.has(row.fieldId)), targetFields);
        }
        return nextConfig;
      }

      if (selectedNode?.data.kind === "update-data" || selectedNode?.data.kind === "delete-data") {
        const nextConfig = normalizeActionConfig(config);
        nextConfig.targetFormUuid = formUuid;
        if (selectedNode.data.kind === "delete-data") { nextConfig.rules = []; nextConfig.matchRule = ""; }
        return nextConfig;
      }

      return {
        ...config,
        targetFormUuid: formUuid,
      };
    });

    if (formUuid) {
      void ensureFormSchema(formUuid);
    }
  }

  function handleAddDataConfigChange<K extends keyof AddDataConfig>(
    key: K,
    value: AddDataConfig[K],
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeAddDataConfig(config);
      nextConfig[key] = value;
      if (key === "targetMode") {
        nextConfig.subformFieldId = "";
        nextConfig.parentDataNodeId = "";
        nextConfig.rows = [];
      }
      if (key === "subformFieldId") nextConfig.rows = [];
      if (key === "parentDataNodeId") {
        const source = nodes.find((node) => node.id === value);
        nextConfig.targetFormUuid = source ? getSourceFormUuid(source, nodes, flowState.triggerFormUuid ?? "") : "";
        nextConfig.subformFieldId = "";
        nextConfig.rows = [];
      }

      if (key === "recordMode" && value === "single") {
        const targetNode = { ...selectedNode!, data: { ...selectedNode!.data, config: nextConfig } };
        if (getSchemaForNodeTarget(targetNode, formSchemas)) {
          const targetFields = getNodeMappingTargetFields(targetNode, formSchemas);
          const targetFieldIds = new Set(targetFields.map((field) => field.id));
          nextConfig.rows = syncRequiredRows(
            (nextConfig.rows ?? []).filter((row) => targetFieldIds.has(row.fieldId)),
            targetFields,
          );
        }
      }

      return nextConfig;
    });
    if (key === "parentDataNodeId") {
      const source = nodes.find((node) => node.id === value);
      const parent = source ? getSourceFormUuid(source, nodes, flowState.triggerFormUuid ?? "") : "";
      if (parent) void ensureFormSchema(parent);
    }
  }

  function handleUpdateConfigChange<K extends keyof ActionConfig>(
    key: K,
    value: ActionConfig[K],
  ) {
    updateSelectedNodeConfig((config) => {
      const next = { ...normalizeActionConfig(config), [key]: value };
      if (selectedNode?.data.kind === "delete-data") {
        if (key === "deleteMode") { next.sourceNodeId = ""; next.targetFormUuid = ""; next.rules = []; }
        if (key === "deleteMode" || key === "filterMode") next.matchRule = "";
      }
      return next;
    });
  }

  function handleUpdateSourceNodeChange(sourceNodeId: string) {
    const sourceNode = nodes.find(
      (node) =>
        node.id === sourceNodeId &&
        (selectedNode?.data.kind === "delete-data"
          ? buildSubformParentOptions(nodes, edges, selectedNode.id).some((option) => option.id === node.id)
          : node.data.kind === "get-one" || node.data.kind === "get-many"),
    );
    const targetFormUuid = sourceNode ? getSourceFormUuid(sourceNode, nodes, flowState.triggerFormUuid ?? "") : "";

    updateSelectedNodeConfig((config) => ({
      ...normalizeActionConfig(config),
      sourceNodeId,
      targetFormUuid,
      ...(selectedNode?.data.kind === "delete-data" ? { matchRule: "", rules: [] } : {}),
    }));

    if (targetFormUuid) {
      void ensureFormSchema(targetFormUuid);
    }
  }

  function normalizeRuleNodeConfig(config: unknown) {
    if (selectedNode && ["get-one", "get-many"].includes(selectedNode.data.kind)) return normalizeGetDataConfig(config);
    const normalized = normalizeActionConfig(config);
    if (selectedNode?.data.kind === "delete-data") normalized.matchRule = "";
    return normalized;
  }

  function handleUpdateRuleChange(
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeRuleNodeConfig(config);
      nextConfig.rules = updateRule(nextConfig.rules ?? [], ruleId, key, value);
      return nextConfig;
    });
  }

  function handleAddUpdateRule(
    parentId?: string,
    siblingOfId?: string,
    count = 1,
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeRuleNodeConfig(config);
      nextConfig.rules = addRule(nextConfig.rules ?? [], parentId, siblingOfId, count);
      return nextConfig;
    });
  }

  function handleRemoveUpdateRule(ruleId: string) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeRuleNodeConfig(config);
      nextConfig.rules = removeRuleTree(nextConfig.rules ?? [], ruleId);
      return nextConfig;
    });
  }

  function updateSelectedConditionBranch(
    branchId: string,
    updater: (branch: ConditionBranch) => ConditionBranch,
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeConditionConfig(config);
      nextConfig.branches = nextConfig.branches?.map((branch) =>
        branch.id === branchId ? updater(branch) : branch,
      );
      return nextConfig;
    });
  }

  function handleConditionBranchChange(
    branchId: string,
    key: "name" | "expression",
    value: string,
  ) {
    updateSelectedConditionBranch(branchId, (branch) => ({
      ...branch,
      [key]: value,
    }));
  }

  function handleConditionModeChange(
    branchId: string,
    value: "all" | "rules" | "expression" | "otherwise",
  ) {
    updateSelectedNodeConfig((config) => changeConditionEntryMode(config, branchId, value));
  }

  function handleMoveConditionBranch(
    branchId: string,
    direction: "up" | "down",
  ) {
    if (selectedNode?.data.kind === "parallel-condition") return;
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeConditionConfig(config);
      const branches = [...(nextConfig.branches ?? [])];
      const currentIndex = branches.findIndex(
        (branch) => branch.id === branchId,
      );
      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (
        branches[currentIndex]?.entryMode === "otherwise" ||
        branches[targetIndex]?.entryMode === "otherwise" ||
        currentIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= branches.length
      ) {
        return nextConfig;
      }
      [branches[currentIndex], branches[targetIndex]] = [
        branches[targetIndex],
        branches[currentIndex],
      ];
      nextConfig.branches = branches.map((branch, index) => ({
        ...branch,
        priority: index + 1,
      }));
      return nextConfig;
    });
  }

  function handleAddConditionRule(
    branchId: string,
    parentId?: string,
    siblingOfId?: string,
    count = 1,
  ) {
    updateSelectedConditionBranch(branchId, (branch) => {
      return { ...branch, rules: addRule(branch.rules, parentId, siblingOfId, count) };
    });
  }

  function handleRemoveConditionRule(branchId: string, ruleId: string) {
    updateSelectedConditionBranch(branchId, (branch) => {
      return { ...branch, rules: removeRuleTree(branch.rules, ruleId) };
    });
  }

  function handleConditionRuleChange(
    branchId: string,
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) {
    updateSelectedConditionBranch(branchId, (branch) => {
      return { ...branch, rules: updateRule(branch.rules, ruleId, key, value) };
    });
  }

  function handleMappingRowChange(
    rowId: string,
    key: keyof FieldMappingRow,
    value: string,
  ) {
    updateSelectedNodeConfig((config) => {
      const nextRowsSource =
        selectedNode?.data.kind === "add-data"
          ? (normalizeAddDataConfig(config).rows ?? [])
          : selectedNode?.data.kind === "update-data"
            ? (normalizeActionConfig(config).rows ?? [])
            : [];
      if (key === "fieldId" && value && nextRowsSource.some((row) => row.id !== rowId && row.fieldId === value)) {
        return config;
      }
      const nextRows = updateMappingRow(nextRowsSource, rowId, key, value);
      if (selectedNode?.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(config);
        nextConfig.rows = nextRows;
        return nextConfig;
      }
      if (selectedNode?.data.kind === "update-data") {
        const nextConfig = normalizeActionConfig(config);
        nextConfig.rows = nextRows;
        return nextConfig;
      }
      return config;
    });
  }

  function handleAddMappingRow() {
    if (
      !selectedNode ||
      (selectedNode.data.kind !== "add-data" &&
        selectedNode.data.kind !== "update-data")
    ) {
      return;
    }

    const config =
      selectedNode.data.kind === "add-data"
        ? normalizeAddDataConfig(selectedNode.data.config)
        : normalizeActionConfig(selectedNode.data.config);
    const targetFields = getNodeMappingTargetFields(selectedNode, formSchemas);
    const usedFieldIds = new Set((config.rows ?? []).map((row) => row.fieldId));
    const candidate = targetFields.find((field) => !usedFieldIds.has(field.id));

    if (!candidate) {
      return;
    }

    updateSelectedNodeConfig((current) => {
      if (selectedNode.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(current);
        nextConfig.rows = addMappingRow(nextConfig.rows ?? [], candidate.id);
        return nextConfig;
      }
      const nextConfig = normalizeActionConfig(current);
      nextConfig.rows = addMappingRow(nextConfig.rows ?? [], candidate.id);
      return nextConfig;
    });
  }

  function handleRemoveMappingRow(rowId: string) {
    if (
      !selectedNode ||
      (selectedNode.data.kind !== "add-data" &&
        selectedNode.data.kind !== "update-data")
    ) {
      return;
    }

    const config =
      selectedNode.data.kind === "add-data"
        ? normalizeAddDataConfig(selectedNode.data.config)
        : normalizeActionConfig(selectedNode.data.config);
    const targetFields = getNodeMappingTargetFields(selectedNode, formSchemas);
    const row = (config.rows ?? []).find((item) => item.id === rowId);
    const field = targetFields.find((item) => item.id === row?.fieldId);

    if (selectedNode.data.kind === "add-data" && field?.isRequired) {
      return;
    }

    updateSelectedNodeConfig((current) => {
      if (selectedNode.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(current);
        nextConfig.rows = removeMappingRow(nextConfig.rows ?? [], rowId);
        return nextConfig;
      }
      const nextConfig = normalizeActionConfig(current);
      nextConfig.rows = removeMappingRow(nextConfig.rows ?? [], rowId);
      return nextConfig;
    });
  }

return { handleNodeLabelChange, updateSelectedNodeConfig, handleBasicNodeConfigChange, handleProcessMemberIdsChange, handleGetNodeSourceModeChange, handleGetNodeFormChange, handleGetNodeSourceNodeChange, handleActionTargetFormChange, handleAddDataConfigChange, handleUpdateConfigChange, handleUpdateSourceNodeChange, normalizeRuleNodeConfig, handleUpdateRuleChange, handleAddUpdateRule, handleRemoveUpdateRule, updateSelectedConditionBranch, handleConditionBranchChange, handleConditionModeChange, handleMoveConditionBranch, handleAddConditionRule, handleRemoveConditionRule, handleConditionRuleChange, handleMappingRowChange, handleAddMappingRow, handleRemoveMappingRow };
}
