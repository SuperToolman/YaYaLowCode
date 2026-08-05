"use client";

import { createContext, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import type { ApiFormSummary } from "@/features/automation-editor/api";
import { AddIcon, FormIcon, TrashIcon } from "../../../../../components/app-icons";
import type { TriggerEvent } from "../automation-shared";
import {
  conditionBranchHandleId,
  conditionBranchSummary,
  nodeKindLabel,
  nodeSummary,
  nodeTone,
  normalizeConditionConfig,
  defaultNodeTemplate,
  workflowNodeWidth,
  type ActionConfig,
  type PaletteNodeKind,
  type AddDataConfig,
  type BranchRule,
  type DataSourceMode,
  type FieldMappingRow,
  type FormFieldDescriptor,
  type FormSchemaDescriptor,
  type MemberOption,
  type SourceFieldChoice,
  type WorkflowEdge,
  type WorkflowNode,
} from "./automation-editor-model";
import { ConditionNodeConfig } from "./automation-condition-node-config";
import { DataNodeConfigFields } from "./automation-data-node-config";
import { FlowNodeConfig } from "./automation-flow-node-config";

export { PropertyField, PropertyPanelSection } from "./automation-node-config-primitives";

export type WorkflowNodeActions = {
  addConditionBranch: (nodeId: string) => void;
  removeConditionBranch: (nodeId: string, branchId: string) => void;
};

export const WorkflowNodeActionsContext = createContext<WorkflowNodeActions>({
  addConditionBranch: () => undefined,
  removeConditionBranch: () => undefined,
});

export function WorkflowCardNode({ id, data, selected }: NodeProps<WorkflowNode>) {
  const canAcceptInput = data.kind !== "trigger";
  const { addConditionBranch, removeConditionBranch } = useContext(WorkflowNodeActionsContext);
  const conditionBranches = data.kind === "condition"
    ? normalizeConditionConfig(data.config).branches ?? []
    : [];

  return (
    <div
      data-workflow-node-card="true"
      className={[
        data.kind === "condition" ? "w-[310px]" : "min-w-[220px] max-w-[280px]",
        "rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-[var(--color-text-primary)] shadow-[var(--shadow-floating)]",
        selected ? "ring-2 ring-[var(--color-primary)]" : "",
      ].join(" ")}
    >
      {canAcceptInput ? (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-[var(--color-bg-surface)] !bg-[var(--color-primary)]"
        />
      ) : null}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
          <FormIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">{data.label}</div>
            <div
              className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${nodeTone[data.kind]}`}
            >
              {nodeKindLabel(data.kind)}
            </div>
          </div>
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{data.description}</div>
        </div>
      </div>
      {data.kind === "condition" ? (
        <div className="mt-3 space-y-2">
          {conditionBranches.map((branch, index) => (
            <div
              key={branch.id}
              className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2.5 pr-8"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
                  {branch.name || `条件分支 ${index + 1}`}
                </span>
                <span className="shrink-0 rounded bg-[var(--color-warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
                  P{branch.priority}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--color-text-secondary)]">
                {conditionBranchSummary(branch)}
              </div>
              {conditionBranches.length > 1 ? (
                <button
                  type="button"
                  aria-label={`删除条件分支 ${index + 1}`}
                  className="nodrag nopan absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeConditionBranch(id, branch.id);
                  }}
                >
                  <TrashIcon />
                </button>
              ) : null}
              <Handle
                id={conditionBranchHandleId(branch.id)}
                type="source"
                position={Position.Right}
                className="!right-[-22px] !h-3 !w-3 !border-2 !border-[var(--color-bg-surface)] !bg-[var(--color-warning)]"
              />
            </div>
          ))}
          <button
            type="button"
            className="nodrag nopan flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-warning)] transition-colors hover:bg-[var(--color-control-soft-hover)]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              addConditionBranch(id);
            }}
          >
            <AddIcon />
            添加分支
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-secondary)] whitespace-pre-wrap">
            {nodeSummary(data)}
          </div>
          <Handle
            type="source"
            position={Position.Right}
            className="!h-3 !w-3 !border-2 !border-[var(--color-bg-surface)] !bg-[var(--color-primary)]"
          />
        </>
      )}
    </div>
  );
}

export function InsertableEdge({
  id,
  source,
  target,
  markerEnd,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<WorkflowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label="在连线上添加节点"
          className="nodrag nopan absolute flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-primary)] bg-[var(--color-bg-surface)] text-[var(--color-primary)] shadow-[var(--shadow-floating)] transition-colors hover:bg-[var(--color-primary-soft)]"
          style={{
            transform: `translate3d(${labelX}px, ${labelY}px, 0) translate(-50%, -50%)`,
            pointerEvents: "all",
            willChange: "transform",
            backfaceVisibility: "hidden",
            contain: "layout paint",
          }}
          onClick={() => data?.onInsert?.(source, target, id)}
        >
          <AddIcon />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export function NodeConfigFields({
  forms,
  members,
  getManySourceOptions,
  updateSourceOptions,
  updateTargetFormOptions,
  multipleSourceFieldChoices,
  node,
  selectedSchema,
  sourceFieldChoices,
  triggerEvents,
  triggerFieldOptions,
  onActionTargetFormChange,
  onAddDataConfigChange,
  onUpdateConfigChange,
  onUpdateSourceNodeChange,
  onAddUpdateRule,
  onRemoveUpdateRule,
  onUpdateRuleChange,
  onAddMappingRow,
  onBasicChange,
  onProcessMemberIdsChange,
  onConditionBranchChange,
  onConditionModeChange,
  onMoveConditionBranch,
  onAddConditionBranch,
  onRemoveConditionBranch,
  onAddConditionRule,
  onRemoveConditionRule,
  onConditionRuleChange,
  onGetNodeFormChange,
  onGetNodeSourceModeChange,
  onGetNodeSourceNodeChange,
  onRemoveMappingRow,
  onRowChange,
}: {
  forms: ApiFormSummary[];
  members: MemberOption[];
  getManySourceOptions: Array<{ id: string; label: string; description: string }>;
  updateSourceOptions: Array<{ id: string; label: string; description: string }>;
  updateTargetFormOptions: Array<{ id: string; label: string }>;
  multipleSourceFieldChoices: SourceFieldChoice[];
  node: WorkflowNode;
  selectedSchema?: FormSchemaDescriptor;
  sourceFieldChoices: SourceFieldChoice[];
  triggerEvents: TriggerEvent[];
  triggerFieldOptions: FormFieldDescriptor[];
  onActionTargetFormChange: (formUuid: string) => void;
  onAddDataConfigChange: <K extends keyof AddDataConfig>(key: K, value: AddDataConfig[K]) => void;
  onUpdateConfigChange: <K extends keyof ActionConfig>(key: K, value: ActionConfig[K]) => void;
  onUpdateSourceNodeChange: (nodeId: string) => void;
  onAddUpdateRule: (parentId?: string, siblingOfId?: string) => void;
  onRemoveUpdateRule: (ruleId: string) => void;
  onUpdateRuleChange: (ruleId: string, key: keyof BranchRule, value: string) => void;
  onAddMappingRow: () => void;
  onBasicChange: (key: string, value: string) => void;
  onProcessMemberIdsChange: (key: "assigneeIds" | "recipientIds", ids: string[]) => void;
  onConditionBranchChange: (
    branchId: string,
    key: "name" | "hitLabel" | "expression",
    value: string,
  ) => void;
  onConditionModeChange: (
    branchId: string,
    value: "all" | "rules" | "expression",
  ) => void;
  onMoveConditionBranch: (branchId: string, direction: "up" | "down") => void;
  onAddConditionBranch: () => void;
  onRemoveConditionBranch: (branchId: string) => void;
  onAddConditionRule: (branchId: string, parentId?: string, siblingOfId?: string, count?: number) => void;
  onRemoveConditionRule: (branchId: string, ruleId: string) => void;
  onConditionRuleChange: (
    branchId: string,
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) => void;
  onGetNodeFormChange: (formUuid: string) => void;
  onGetNodeSourceModeChange: (value: DataSourceMode) => void;
  onGetNodeSourceNodeChange: (nodeId: string) => void;
  onRemoveMappingRow: (rowId: string) => void;
  onRowChange: (rowId: string, key: keyof FieldMappingRow, value: string) => void;
}) {
  if (["approval", "executor", "copy", "end", "trigger"].includes(node.data.kind)) {
    return (
      <FlowNodeConfig
        members={members}
        node={node}
        onBasicChange={onBasicChange}
        onProcessMemberIdsChange={onProcessMemberIdsChange}
        triggerEvents={triggerEvents}
        triggerFieldOptions={triggerFieldOptions}
      />
    );
  }

  if (node.data.kind === "condition") {
    return (
      <ConditionNodeConfig
        node={node}
        onAddConditionBranch={onAddConditionBranch}
        onAddConditionRule={onAddConditionRule}
        onConditionBranchChange={onConditionBranchChange}
        onConditionModeChange={onConditionModeChange}
        onConditionRuleChange={onConditionRuleChange}
        onMoveConditionBranch={onMoveConditionBranch}
        onRemoveConditionBranch={onRemoveConditionBranch}
        onRemoveConditionRule={onRemoveConditionRule}
        sourceFieldChoices={sourceFieldChoices}
      />
    );
  }

  if (["get-one", "get-many", "add-data", "update-data", "delete-data", "http-request"].includes(node.data.kind)) {
    return (
      <DataNodeConfigFields
        forms={forms}
        getManySourceOptions={getManySourceOptions}
        multipleSourceFieldChoices={multipleSourceFieldChoices}
        node={node}
        onActionTargetFormChange={onActionTargetFormChange}
        onAddDataConfigChange={onAddDataConfigChange}
        onAddMappingRow={onAddMappingRow}
        onAddUpdateRule={onAddUpdateRule}
        onBasicChange={onBasicChange}
        onGetNodeFormChange={onGetNodeFormChange}
        onGetNodeSourceModeChange={onGetNodeSourceModeChange}
        onGetNodeSourceNodeChange={onGetNodeSourceNodeChange}
        onRemoveMappingRow={onRemoveMappingRow}
        onRemoveUpdateRule={onRemoveUpdateRule}
        onRowChange={onRowChange}
        onUpdateConfigChange={onUpdateConfigChange}
        onUpdateRuleChange={onUpdateRuleChange}
        onUpdateSourceNodeChange={onUpdateSourceNodeChange}
        selectedSchema={selectedSchema}
        sourceFieldChoices={sourceFieldChoices}
        updateSourceOptions={updateSourceOptions}
        updateTargetFormOptions={updateTargetFormOptions}
      />
    );
  }

  return null;
}

export function createWorkflowNode(kind: PaletteNodeKind, index: number): WorkflowNode {
  return {
    id: `${kind}-${Date.now()}-${index}`,
    type: "workflow",
    position: { x: 360 + index * 32, y: 180 + index * 40 },
    data: defaultNodeTemplate(kind),
  };
}

export function getInsertedNodePosition(
  source: WorkflowNode,
  target: WorkflowNode,
  nextNode: WorkflowNode,
) {
  const sourceWidth = source.measured?.width ?? workflowNodeWidth(source);
  const targetWidth = target.measured?.width ?? workflowNodeWidth(target);
  const nextNodeWidth = workflowNodeWidth(nextNode);

  return {
    x:
      (source.position.x + sourceWidth / 2 + target.position.x + targetWidth / 2) / 2 -
      nextNodeWidth / 2,
    y: (source.position.y + target.position.y) / 2,
  };
}
