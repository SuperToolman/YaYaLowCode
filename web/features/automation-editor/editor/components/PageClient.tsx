"use client";

import { assertApiResult, assertApiEnvelope } from "@/shared/lib/api-request";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { automationSaveMetadata, automationSaveErrorMessage } from "../../model/automation-save";
import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { addEdge, applyEdgeChanges, applyNodeChanges, ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type NodeChange, type OnConnect, type OnConnectEnd } from "@xyflow/react";
import { Button, ButtonGroup, Input, ListBox, Select, Slider, Switch, TextArea, Label } from "@heroui/react";
import { getAutomationFlow, getFormSchema, listDetailForms, listAutomationFlowVersions, listForms, listUsers, listRoles, restoreAutomationFlowVersion, updateAutomationFlow, type ApiAutomationFlowVersionSummary, type ApiDetailForm, type ApiFormSummary, type UpdateAutomationFlowRequest } from "@/features/automation-editor/api";
import { Code as CodeIcon, Clock as VersionIcon, FloppyDisk as SaveIcon, Pencil as EditIcon, Check as EnabledIcon, Xmark as DisabledIcon } from "@gravity-ui/icons";
import { AutomationNameModal } from "./modals/AutomationNameModal";
import { AutomationNodeInsertModal } from "./modals/AutomationNodeInsertModal";
import { AutomationSchemaModal } from "./modals/AutomationSchemaModal";
import { AutomationVersionsModal } from "./modals/AutomationVersionsModal";
import { type TriggerEvent } from "../../model/management-types";
import { automationWorkflowNodeRegistry, processWorkflowNodeRegistry } from "../../model/node-registry";
import { hasReachableProcessApproval, validateWorkflowGraph, validateWorkflowNodeConfigs } from "@/features/workflow/editor/workflow-core";
import { WorkflowCanvas } from "@/features/workflow/editor/WorkflowCanvas";
import { useAppHeaderActions } from "@/features/application/shell-context";
import { AUTOMATION_TITLE_CHANGED_EVENT, type AutomationTitleChangedDetail } from "@/features/automation-editor/model/title-events";
import { WorkflowNodeConfigDrawer } from "@/features/workflow/editor/WorkflowNodeConfigDrawer";
import { InsertableEdge, NodeConfigFields, PropertyField, PropertyPanelSection, createWorkflowNode, getInsertedNodePosition, WorkflowCardNode, WorkflowNodeActionsContext, WorkflowNodeSummaryContext, type WorkflowNodeActions } from "./AutomationNodeEditorComponents";
import { buildAutomationName, buildDataNodeFieldChoices, buildGetManySourceOptions, buildGetSourceOptions, buildSubformParentOptions, validateDeleteNodeConfiguration, getSchemaForSourceNode, getSourceFormUuid, validateGetNodeConfiguration, buildQueryNodeOptions, buildSourceFieldChoices, buildUpdateTargetFormOptions, collectSchemaTargets, conditionBranchHandleId, createConditionBranch, createEditorEdge, defaultSourceHandleForNode, decorateEdges, ensureTriggerNode, formatDateLabel, getSchemaForNodeTarget, getNodeMappingTargetFields, hasUpdateTriggerEvent, migrateConditionEdgeHandles, nodeKindLabel, nodeTone, normalizeActionConfig, normalizeAddDataConfig, normalizeAssigneeConfig, normalizeConditionConfig, normalizeFormSchema, normalizeGetDataConfig, normalizeTriggerConfig, normalizeWorkflowEdges, normalizeWorkflowNodes, orderTriggerEvents, serializeWorkflow, syncRequiredRows, syncTriggerNode, triggerEventRows } from "../../model/automation-editor-model";
import type { FlowState, FormSchemaDescriptor, InsertContext, MemberOption, RoleOption, PaletteNodeKind, TriggerConfig, WorkflowEdge, WorkflowNode } from "@/features/automation-editor/model/editor-types";
import { triggerDataNodeMenu, processDataNodeMenu } from "@/features/automation-editor/model/node-registry";
import { useNodeConfigActions } from "../use-node-config-actions";

type AutomationEditorPageClientProps = {
  appId: string;
  automationId: string;
};

const edgeTypes = {
  insertable: memo(InsertableEdge),
};

const nodeTypes = {
  workflow: memo(WorkflowCardNode),
};

export function AutomationEditorPageClient({
  appId,
  automationId,
}: AutomationEditorPageClientProps) {
  return (
    <ReactFlowProvider>
      <AutomationEditorSurface appId={appId} automationId={automationId} />
    </ReactFlowProvider>
  );
}

function AutomationEditorSurface({
  appId,
  automationId,
}: AutomationEditorPageClientProps) {
  const { screenToFlowPosition } = useReactFlow();
  const [flowState, setFlowState] = useState<FlowState>({
    flowType: "trigger",
    name: "",
    description: "",
    status: "paused",
    currentVersion: 1,
    triggerFormUuid: "",

    triggerEvents: ["after_create"],
    triggerConfig: {},
  });
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  useEffect(() => {
    void Promise.all([
      listUsers({ responseStyle: "fields" }),
      listRoles({ responseStyle: "fields" }),
    ]).then(([userResult, roleResult]) => {
      if (userResult.data?.code === 0 && userResult.data.data)
        setMembers(
          userResult.data.data
            .filter((user) => user.status === "active")
            .map((user) => ({
              id: user.id,
              displayName: user.displayName,
              status: user.status,
              sourceType: user.sourceType,
              avatarUrl: user.avatarUrl,
            })),
        );
      if (roleResult.data?.code === 0 && roleResult.data.data)
        setRoles(
          roleResult.data.data
            .filter((role) => role.status === "active")
            .map((role) => ({
              id: role.id,
              name: role.name,
              status: role.status,
              sourceType: role.sourceType,
            })),
        );
    });
  }, []);
  const dataNodeMenu =
    flowState.flowType === "process"
      ? processDataNodeMenu
      : triggerDataNodeMenu;
  const [forms, setForms] = useState<ApiFormSummary[]>([]);
  const [detailForms, setDetailForms] = useState<ApiDetailForm[]>([]);
  const [formSchemas, setFormSchemas] = useState<
    Record<string, FormSchemaDescriptor>
  >({});
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [insertContext, setInsertContext] = useState<InsertContext | null>(
    null,
  );
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isNameSaving, setIsNameSaving] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(0.9);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionItems, setVersionItems] = useState<
    ApiAutomationFlowVersionSummary[]
  >([]);
  const [isVersionsLoading, setIsVersionsLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, startTransition] = useTransition();
  const { headerActionsTarget } = useAppHeaderActions();

  const handleInsertRequest = useCallback(
    (sourceId: string, targetId: string, edgeId: string) => {
      setInsertContext({ sourceId, targetId, edgeId });
    },
    [],
  );

  const handleAddConditionBranch = useCallback((nodeId: string) => {
    setNodes((current) =>
      current.map((node) => {
        if (
          node.id !== nodeId ||
          (node.data.kind !== "condition" &&
            node.data.kind !== "parallel-condition")
        ) {
          return node;
        }

        const config = normalizeConditionConfig(node.data.config);
        const branches = config.branches ?? [];
        const nextPriority = branches.length + 1;
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              branches: [
                ...branches.filter((branch) => branch.entryMode !== "otherwise"),
                createConditionBranch(nextPriority),
                ...branches.filter((branch) => branch.entryMode === "otherwise"),
              ].map((branch, index) => ({ ...branch, priority: index + 1 })),
            },
          },
        };
      }),
    );
    setSelectedNodeId(nodeId);
  }, []);

  const handleRemoveConditionBranch = useCallback(
    (nodeId: string, branchId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (
            node.id !== nodeId ||
            (node.data.kind !== "condition" &&
              node.data.kind !== "parallel-condition")
          ) {
            return node;
          }
          const config = normalizeConditionConfig(node.data.config);
          if ((config.branches?.length ?? 0) <= 1) {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                branches: config.branches?.filter(
                  (branch) => branch.id !== branchId,
                ),
              },
            },
          };
        }),
      );
      setEdges((current) =>
        current.filter(
          (edge) =>
            !(
              edge.source === nodeId &&
              edge.sourceHandle === conditionBranchHandleId(branchId)
            ),
        ),
      );
    },
    [],
  );

  const workflowNodeActions = useMemo<WorkflowNodeActions>(
    () => ({
      addConditionBranch: handleAddConditionBranch,
      removeConditionBranch: handleRemoveConditionBranch,
    }),
    [handleAddConditionBranch, handleRemoveConditionBranch],
  );

  const [schemaStatus, setSchemaStatus] = useState<Record<string, "loading" | "ready" | "error">>({});

  const ensureFormSchema = useCallback(async (formUuid: string) => {
    if (!formUuid) {
      return;
    }

    setSchemaStatus((current) => ({ ...current, [formUuid]: "loading" }));
    try {
    const result = await getFormSchema({
      path: { formUuid },
      responseStyle: "fields",
    });

    if (
      result.error ||
      !result.data ||
      result.data.code !== 0 ||
      !result.data.data
    ) {
      setSchemaStatus((current) => ({ ...current, [formUuid]: "error" }));
      return;
    }

    const normalized = normalizeFormSchema(
      result.data.data.schema as Record<string, unknown>,
    );
    setFormSchemas((current) => ({
      ...current,
      [formUuid]: { ...normalized, formUuid },
    }));
    setSchemaStatus((current) => ({ ...current, [formUuid]: "ready" }));
    } catch { setSchemaStatus((current) => ({ ...current, [formUuid]: "error" })); }
  }, []);

  const loadEditor = useCallback(async () => {
    setIsLoading(true);
    try {
      const [detailResult, formsResult] = await Promise.all([
        getAutomationFlow({
          path: { automationId },
          responseStyle: "fields",
        }),
        listForms({
          path: { appId },
          responseStyle: "fields",
        }),
      ]);

      assertApiResult(detailResult);

      assertApiResult(formsResult);

      const detail = detailResult.data.data;
      const nextFlowState: FlowState = {
        flowType: detail.flowType === "process" ? "process" : "trigger",
        name: detail.name,
        description: detail.description ?? "",
        status: detail.status,
        currentVersion: detail.currentVersion,
        triggerFormUuid: detail.triggerFormUuid ?? "",

        triggerEvents: detail.triggerEvents,
        triggerConfig: normalizeTriggerConfig(detail.triggerConfig),
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      };
      const nextNodes = ensureTriggerNode(
        normalizeWorkflowNodes(detail.nodes),
        nextFlowState,
        formsResult.data.data,
      );

      setFlowState(nextFlowState);
      setForms(formsResult.data.data);
      const detailFormResults = await Promise.all(
        formsResult.data.data
          .filter((form) => form.formType !== "detail")
          .map((form) =>
            listDetailForms({
              path: { formUuid: form.id },
              responseStyle: "fields",
            }),
          ),
      );
      setDetailForms(
        detailFormResults.flatMap((result) =>
          result.data?.code === 0 && result.data.data ? result.data.data : [],
        ),
      );
      setNodes(nextNodes);
      setEdges(
        decorateEdges(
          migrateConditionEdgeHandles(
            normalizeWorkflowEdges(detail.edges),
            nextNodes,
          ),
          handleInsertRequest,
        ),
      );
      setSelectedNodeId(null);

      const schemaTargets = new Set(collectSchemaTargets(nextFlowState, nextNodes));
      if (nextFlowState.triggerFormUuid) schemaTargets.add(nextFlowState.triggerFormUuid);
      if (schemaTargets.size > 0) {
        await Promise.all(
          [...schemaTargets].map((formUuid) => ensureFormSchema(formUuid)),
        );
      }
    } catch (cause) {
      notifyRequestError(cause, "自动化详情加载失败", { description: cause instanceof Error ? cause.message : "请确认后端服务正常" });
    } finally {
      setIsLoading(false);
    }
  }, [appId, automationId, ensureFormSchema, handleInsertRequest]);

  const isProcessFlow = flowState.flowType === "process";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEditor();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadEditor]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedDeleteConfig = selectedNode?.data.kind === "delete-data" ? normalizeActionConfig(selectedNode.data.config) : undefined;
  const selectedDeleteSource = selectedDeleteConfig?.deleteMode === "data-node"
    ? nodes.find((node) => node.id === selectedDeleteConfig.sourceNodeId) : undefined;
  const selectedDeleteForm = selectedDeleteSource ? getSourceFormUuid(selectedDeleteSource, nodes, flowState.triggerFormUuid ?? "") : "";
  useEffect(() => {
    if (!selectedNode || selectedDeleteConfig?.deleteMode !== "data-node" || selectedDeleteConfig.targetFormUuid === selectedDeleteForm) return;
    const timer = window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.id === selectedNode.id
        ? { ...node, data: { ...node.data, config: { ...selectedDeleteConfig, targetFormUuid: selectedDeleteForm } } } : node));
      if (selectedDeleteForm) void ensureFormSchema(selectedDeleteForm);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedNode, selectedDeleteConfig, selectedDeleteForm, ensureFormSchema]);
  const selectedNodeSchema =
    selectedNode?.data.kind === "initiate-approval" ||
    selectedNode?.data.kind === "add-data" ||
    selectedNode?.data.kind === "update-data" ||
    selectedNode?.data.kind === "delete-data"
      ? getSchemaForNodeTarget(selectedNode, formSchemas)
      : selectedNode && ["get-one", "get-many"].includes(selectedNode.data.kind)
        ? getSchemaForSourceNode(selectedNode, formSchemas, flowState, nodes) : undefined;
  const selectedSubformConfig = selectedNode?.data.kind === "add-data" ? normalizeAddDataConfig(selectedNode.data.config) : undefined;
  const selectedSubformSource = nodes.find((node) => node.id === selectedSubformConfig?.parentDataNodeId);
  const selectedSubformParent = selectedSubformSource ? getSourceFormUuid(selectedSubformSource, nodes, flowState.triggerFormUuid ?? "") : "";
  useEffect(() => {
    if (!selectedNode || selectedSubformConfig?.targetMode !== "subtable" || selectedSubformConfig.targetFormUuid === selectedSubformParent) return;
    const timer = window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, config: { ...selectedSubformConfig, targetFormUuid: selectedSubformParent, subformFieldId: "", rows: [] } } } : node));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedNode, selectedSubformConfig, selectedSubformParent]);
  useEffect(() => {
    if (!selectedNode || selectedNode.data.kind !== "add-data" || !selectedNodeSchema) return;
    const config = normalizeAddDataConfig(selectedNode.data.config);
    const targetFields = getNodeMappingTargetFields(selectedNode, formSchemas);
    const targetFieldIds = new Set(targetFields.map((field) => field.id));
    const currentRows = config.rows ?? [];
    const requiredRows = syncRequiredRows(currentRows.filter((row) => targetFieldIds.has(row.fieldId)), targetFields);
    if (requiredRows.length === currentRows.length && requiredRows.every((row, index) => row.id === currentRows[index]?.id)) return;
    const timer = window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, config: { ...config, rows: requiredRows } } } : node));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedNode, selectedNodeSchema, formSchemas]);
  const selectedQueryFormUuid = selectedNode?.data.kind === "initiate-approval" ? (selectedNode.data.config as { targetFormUuid?: string }).targetFormUuid ?? "" : selectedNode && ["get-one", "get-many"].includes(selectedNode.data.kind)
    ? getSourceFormUuid(selectedNode, nodes, flowState.triggerFormUuid ?? "") : "";
  const selectedQuerySchemaLoaded = Boolean(formSchemas[selectedQueryFormUuid]);
  useEffect(() => {
    if (!selectedQueryFormUuid || selectedQuerySchemaLoaded) return;
    const timer = window.setTimeout(() => { void ensureFormSchema(selectedQueryFormUuid); }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedQueryFormUuid, selectedQuerySchemaLoaded, ensureFormSchema]);
  const editorSchemas = formSchemas;
  const sourceFieldChoices = buildSourceFieldChoices({
    currentNodeId: selectedNodeId,
    edges,
    formSchemas: editorSchemas,
    flowState,
    nodes,
  });
  const triggerFieldOptions = flowState.triggerFormUuid ? (formSchemas[flowState.triggerFormUuid]?.fields ?? []) : [];
  const getManySourceOptions = buildGetManySourceOptions(
    nodes,
    edges,
    selectedNodeId,
  );
  const updateSourceOptions = buildQueryNodeOptions(nodes, edges, selectedNodeId);
  const updateTargetFormOptions = buildUpdateTargetFormOptions(
    forms,
    detailForms,
  );
  const selectedAddDataConfig =
    selectedNode?.data.kind === "add-data"
      ? normalizeAddDataConfig(selectedNode.data.config)
      : null;
  const multipleSourceFieldChoices = selectedAddDataConfig?.multipleSourceNodeId
    ? buildDataNodeFieldChoices({
        formSchemas,
        nodeId: selectedAddDataConfig.multipleSourceNodeId,
        triggerFormUuid: flowState.triggerFormUuid ?? "",
        nodes,
      })
    : [];

  const onNodesChange = (changes: NodeChange<WorkflowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  };

  const onEdgesChange = (changes: EdgeChange<WorkflowEdge>[]) => {
    setEdges((current) =>
      decorateEdges(applyEdgeChanges(changes, current), handleInsertRequest),
    );
  };

  const onConnect: OnConnect = (connection: Connection) => {
    if (
      !connection.source ||
      !connection.target ||
      connection.target === "trigger-1"
    ) {
      return;
    }

    setEdges((current) =>
      decorateEdges(
        addEdge(
          createEditorEdge(
            connection.source,
            connection.target,
            connection.sourceHandle,
            connection.targetHandle,
          ),
          current,
        ),
        handleInsertRequest,
      ),
    );
  };

  const handleConnectEnd: OnConnectEnd = (event, connectionState) => {
    if (connectionState.isValid || !connectionState.fromNode) {
      return;
    }

    const clientPoint =
      "changedTouches" in event ? event.changedTouches[0] : event;
    if (!clientPoint) {
      return;
    }

    setInsertContext({
      sourceId: connectionState.fromNode.id,
      sourceHandle: connectionState.fromHandle.id,
      position: screenToFlowPosition({
        x: clientPoint.clientX,
        y: clientPoint.clientY,
      }),
    });
  };

  function handleFlowFieldChange<K extends keyof FlowState>(
    key: K,
    value: FlowState[K],
  ) {
    setFlowState((current) => {
      const nextState = { ...current, [key]: value };
      if (key === "triggerFormUuid") {
        nextState.triggerConfig = {
          ...nextState.triggerConfig,
          changedFieldMode: "any",
          changedFieldId: "",

        };
      }
      setNodes((currentNodes) =>
        syncTriggerNode(currentNodes, nextState, forms),
      );
      return nextState;
    });

    if (key === "triggerFormUuid" && typeof value === "string" && value) {
      void ensureFormSchema(value);
    }
  }

  function handleTriggerEventSelection(
    events: TriggerEvent[],
    event: TriggerEvent,
    selected: boolean,
  ) {
    setFlowState((current) => {
      const triggerEvents = orderTriggerEvents(
        selected
          ? [
              ...current.triggerEvents.filter((item) => event !== "button_click" && item !== "button_click" && !events.includes(item)),
              event,
            ]
          : current.triggerEvents.filter((item) => item !== event),
      );
      const nextState = {
        ...current,

        triggerEvents,
        triggerConfig: hasUpdateTriggerEvent(triggerEvents)
          ? current.triggerConfig
          : {
              ...current.triggerConfig,
              changedFieldMode: "any" as const,
              changedFieldId: "",

            },
      };
      setNodes((currentNodes) =>
        syncTriggerNode(currentNodes, nextState, forms),
      );
      return nextState;
    });
  }

  function handleTriggerConfigChange(key: keyof TriggerConfig, value: string) {
    setFlowState((current) => {
      const triggerConfig = {
        ...current.triggerConfig,
        [key]: value,
      };
      if (key === "changedFieldMode" && value === "any") {
        triggerConfig.changedFieldId = "";
      }
      const nextState = {
        ...current,
        triggerConfig,
      };
      setNodes((currentNodes) =>
        syncTriggerNode(currentNodes, nextState, forms),
      );
      return nextState;
    });
  }

  function openNameModal() {
    if (isProcessFlow) return;
    setNameDraft(flowState.name);
    setDescriptionDraft(flowState.description);
    setIsNameModalOpen(true);
  }

  async function submitName() {
    if (isProcessFlow) return;
    const name = nameDraft.trim();
    if (!name) {
      notify.error("请输入自动化名称");
      return;
    }

    setIsNameSaving(true);
    try {
      const { data, error , response: httpResponse0 } = await updateAutomationFlow({
        path: { automationId },
        body: { name, description: descriptionDraft.trim() || null },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, httpResponse0);
      const updatedFlow = data.data;

      setFlowState((current) => ({
        ...current,
        name: updatedFlow.name,
        description: updatedFlow.description ?? "",
        currentVersion: updatedFlow.currentVersion,
        updatedAt: updatedFlow.updatedAt,
      }));
      window.dispatchEvent(
        new CustomEvent<AutomationTitleChangedDetail>(
          AUTOMATION_TITLE_CHANGED_EVENT,
          { detail: { automationId, name: updatedFlow.name } },
        ),
      );
      setIsNameModalOpen(false);
      notify.success("自动化名称已更新");
    } catch (cause) {
      notifyRequestError(cause, "更新自动化名称失败", {
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setIsNameSaving(false);
    }
  }

  function handleStatusToggle(nextStatus: "enabled" | "paused") {
    handleFlowFieldChange("status", nextStatus);
  }

  async function openVersionModal() {
    setIsVersionModalOpen(true);
    setIsVersionsLoading(true);

    try {
      const result = await listAutomationFlowVersions({
        path: { automationId },
        responseStyle: "fields",
      });

      assertApiResult(result);

      setVersionItems(result.data.data);
    } catch {
      setVersionItems([]);
    } finally {
      setIsVersionsLoading(false);
    }
  }

  async function handleRestoreVersion(version: number) {
    setRestoringVersion(version);

    try {
      const { data, error } = await restoreAutomationFlowVersion({
        path: { automationId, version },
        body: {
          change_log: `restored from v${version}`,
        },
        responseStyle: "fields",
      });

      if (error || !data || data.code !== 0 || !data.data) {
        throw error ?? new Error(data?.message || "切换版本失败");
      }

      notify.success(`已切换到 v${version}`);
      await openVersionModal();
      await loadEditor();
    } catch (cause) {
      notifyRequestError(cause, "切换版本失败", { description: automationSaveErrorMessage(cause) });
    } finally {
      setRestoringVersion(null);
    }
  }

  const { handleNodeLabelChange, updateSelectedNodeConfig, handleBasicNodeConfigChange, handleProcessMemberIdsChange, handleGetNodeSourceModeChange, handleGetNodeFormChange, handleGetNodeSourceNodeChange, handleActionTargetFormChange, handleAddDataConfigChange, handleUpdateConfigChange, handleUpdateSourceNodeChange, handleUpdateRuleChange, handleAddUpdateRule, handleRemoveUpdateRule, handleConditionBranchChange, handleConditionModeChange, handleMoveConditionBranch, handleAddConditionRule, handleRemoveConditionRule, handleConditionRuleChange, handleMappingRowChange, handleAddMappingRow, handleRemoveMappingRow } = useNodeConfigActions({ selectedNodeId, selectedNode, setNodes, nodes, edges, formSchemas, flowState, ensureFormSchema, handleTriggerConfigChange });

  function handleInsertNode(kind: PaletteNodeKind) {
    if (!insertContext) {
      return;
    }

    const nextNode = createWorkflowNode(kind, nodes.length);
    const source = nodes.find((node) => node.id === insertContext.sourceId);
    const target = insertContext.targetId
      ? nodes.find((node) => node.id === insertContext.targetId)
      : null;
    const position = insertContext.position
      ? {
          x: insertContext.position.x - 120,
          y: insertContext.position.y - 32,
        }
      : source && target
        ? getInsertedNodePosition(source, target, nextNode)
        : nextNode.position;

    setNodes((current) => [
      ...current,
      {
        ...nextNode,
        position,
      },
    ]);
    setEdges((current) => {
      const replacedEdge = insertContext.edgeId
        ? current.find((edge) => edge.id === insertContext.edgeId)
        : undefined;
      return decorateEdges(
        [
          ...current.filter((edge) => edge.id !== insertContext.edgeId),
          createEditorEdge(
            insertContext.sourceId,
            nextNode.id,
            insertContext.sourceHandle ?? replacedEdge?.sourceHandle,
          ),
          ...(insertContext.targetId
            ? [
                createEditorEdge(
                  nextNode.id,
                  insertContext.targetId,
                  defaultSourceHandleForNode(nextNode),
                  replacedEdge?.targetHandle,
                ),
              ]
            : []),
        ],
        handleInsertRequest,
      );
    });
    setSelectedNodeId(null);
    setInsertContext(null);
  }

  function handleDeleteSelectedNode() {
    if (!selectedNode || selectedNode.data.kind === "trigger") {
      return;
    }

    setNodes((current) =>
      current.filter((node) => node.id !== selectedNode.id),
    );
    setEdges((current) =>
      decorateEdges(
        current.filter(
          (edge) =>
            edge.source !== selectedNode.id && edge.target !== selectedNode.id,
        ),
        handleInsertRequest,
      ),
    );
    setSelectedNodeId(null);
  }

  function handleSaveFlow() {
    startTransition(async () => {
      try {
        const synchronizedNodes = syncTriggerNode(nodes, flowState, forms);
        const validationIssues = validateWorkflowGraph(
          synchronizedNodes,
          edges,
          {
            rootKinds: (flowState.flowType === "process"
              ? processWorkflowNodeRegistry
              : automationWorkflowNodeRegistry
            )
              .filter((definition) => definition.isRoot)
              .map((definition) => definition.kind),
          },
        );
        if (validationIssues.some((issue) => issue.severity === "error")) {
          notify.warning("无法保存工作流", {
            description: "工作流存在无效入口、失效连线或循环依赖。",
          });
          return;
        }
        if (
          flowState.flowType === "process" &&
          !hasReachableProcessApproval(synchronizedNodes, edges)
        ) {
          notify.warning("无法保存审批流程", {
            description: "必须至少存在一个从表单提交节点可抵达的审批人节点。",
          });
          return;
        }
        const configIssues = validateWorkflowNodeConfigs(
          synchronizedNodes,
          flowState.flowType === "process"
            ? processWorkflowNodeRegistry
            : automationWorkflowNodeRegistry,
        );
        if (flowState.status === "enabled" && !flowState.triggerFormUuid) {
          configIssues.push({
            code: "missing-trigger-form",
            message: "请先选择触发表单",
            severity: "error",
            nodeId: "trigger-1",
          });
        }
        if (
          flowState.status === "enabled" &&
          configIssues.some((issue) => issue.severity === "error")
        ) {
          notify.warning("无法保存工作流", {
            description: configIssues.find((issue) => issue.severity === "error")?.message ??
              "节点配置不完整，无法启动。",
          });
          return;
        }
        for (const node of synchronizedNodes) {
          const deleteIssue = validateDeleteNodeConfiguration(node, synchronizedNodes, edges, formSchemas, flowState);
          if (deleteIssue) { notify.warning("无法保存删除节点", { description: `${node.data.label}: ${deleteIssue}` }); return; }
          if (node.data.kind === "add-data") {
            const config = normalizeAddDataConfig(node.data.config);
            if (config.targetMode === "subtable") {
              const options = buildSubformParentOptions(synchronizedNodes, edges, node.id);
              if (!config.targetFormUuid || !config.subformFieldId || !options.some((source) => source.id === config.parentDataNodeId)) {
                notify.warning("无法保存子表新增节点", { description: "请选择上游数据节点及其所属子表" }); return;
              }
            }
          }
          const issue = validateGetNodeConfiguration(node, synchronizedNodes, edges, formSchemas, flowState);
          if (issue) { notify.warning("无法保存获取节点", { description: `${node.data.label}: ${issue}` }); return; }
        }
        const payload = serializeWorkflow(synchronizedNodes, edges);
        const { data, error } = await updateAutomationFlow({
          path: { automationId },
          body: {
            ...automationSaveMetadata(flowState, buildAutomationName(forms, flowState.triggerFormUuid)),
            nodes: payload.nodes,
            edges: payload.edges,
          } as UpdateAutomationFlowRequest & { triggerEvents?: TriggerEvent[] },
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw error ?? data ?? new Error("保存自动化编排失败，请稍后重试。");
        }

        setNodes(synchronizedNodes);
        const savedFlow = data.data;
        setFlowState((current) => ({
          ...current,
          currentVersion: savedFlow.currentVersion,
          updatedAt: savedFlow.updatedAt,
        }));
        notify.success("工作流已保存");
      } catch (error) {
        notifyRequestError(error, "工作流保存失败", {
          description: automationSaveErrorMessage(error),
        });
      }
    });
  }

  const automationSchema = useMemo(() => {
    const synchronizedNodes = syncTriggerNode(nodes, flowState, forms);
    const workflow = serializeWorkflow(synchronizedNodes, edges);

    return JSON.stringify(
      {
        automationId,
        name:
          flowState.name ||
          buildAutomationName(forms, flowState.triggerFormUuid),
        description: flowState.description || undefined,
        status: flowState.status,
        currentVersion: flowState.currentVersion,
        triggerFormUuid: flowState.triggerFormUuid || undefined,

        triggerEvents: flowState.triggerEvents,
        triggerConfig: flowState.triggerConfig,
        ...workflow,
      },
      null,
      2,
    );
  }, [automationId, edges, flowState, forms, nodes]);

  const displayStatus = flowState.status === "enabled" ? "enabled" : "paused";

  const headerActions = (
    <div
      className="flex items-center gap-2"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className="whitespace-nowrap text-xs leading-4 text-[var(--color-text-secondary)]">
          {displayStatus === "enabled" ? "已启动" : "已停止"}
        </span>
        <Switch
          aria-label="启动自动化"
          isSelected={displayStatus === "enabled"}
          onChange={(enabled) =>
            handleStatusToggle(enabled ? "enabled" : "paused")
          }
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb>
                <Switch.Icon>
                  {displayStatus === "enabled" ? (
                    <EnabledIcon className="size-3" />
                  ) : (
                    <DisabledIcon className="size-3" />
                  )}
                </Switch.Icon>
              </Switch.Thumb>
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>
      <CanvasZoomControl zoom={canvasZoom} onZoomChange={setCanvasZoom} />
      <ButtonGroup
        aria-label="自动化编排操作"
        className="shrink-0"
        variant="secondary"
      >
        <Button onPress={() => setIsSchemaModalOpen(true)}>
          <CodeIcon />
          Schema
        </Button>
        <Button onPress={() => void openVersionModal()}>
          <ButtonGroup.Separator />
          <VersionIcon />
          版本
        </Button>
        <Button onPress={openNameModal} isDisabled={isProcessFlow}>
          <ButtonGroup.Separator />
          <EditIcon />
          编辑名称
        </Button>
        <Button
          variant="primary"
          onPress={handleSaveFlow}
          isDisabled={isSaving}
        >
          <SaveIcon />
          保存
        </Button>
      </ButtonGroup>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10 text-sm text-[var(--color-text-secondary)]">
        正在加载自动化编排...
      </div>
    );
  }

  return (
    <>
      {headerActionsTarget
        ? createPortal(headerActions, headerActionsTarget)
        : null}
      <div className="flex h-full min-h-0 flex-col">
        <section className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,var(--color-bg-subtle)_0%,var(--color-bg-surface)_42%,var(--color-bg-canvas)_100%)]">
          <WorkflowNodeActionsContext.Provider value={workflowNodeActions}>
            <WorkflowNodeSummaryContext.Provider
              value={{ flowState, members, roles, fields: triggerFieldOptions }}
            >
              <WorkflowCanvas<WorkflowNode, WorkflowEdge>
                nodes={nodes}
                edges={edges}
                edgeTypes={edgeTypes}
                nodeTypes={nodeTypes}
                onConnect={onConnect}
                onConnectEnd={handleConnectEnd}
                onEdgesChange={onEdgesChange}
                onNodesChange={onNodesChange}
                onNodeSelect={(node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                onZoomChange={setCanvasZoom}
              />
            </WorkflowNodeSummaryContext.Provider>
          </WorkflowNodeActionsContext.Provider>
          {selectedNode ? (
            <WorkflowNodeConfigDrawer
              isOpen
              onOpenChange={(isOpen) => {
                if (!isOpen) {
                  setSelectedNodeId(null);
                }
              }}
              title={selectedNode.data.label}
              subtitle={`${nodeKindLabel(selectedNode.data.kind)}节点参数`}
              onDelete={
                selectedNode.data.kind !== "trigger"
                  ? handleDeleteSelectedNode
                  : undefined
              }
            >
              {selectedNode.data.kind === "trigger" ? (
                <PropertyPanelSection
                  title={
                    flowState.flowType === "process" ? "流程起点" : "触发配置"
                  }
                  description="工作流名称和说明在左上角双击编辑。"
                >
                  {flowState.flowType === "process" ? (
                    <div className="rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
                      表单提交时
                    </div>
                  ) : (
                    <>
                      {flowState.triggerEvents.includes("button_click") ? (
                        <p className="text-sm text-muted">{forms.find((form) => form.id === flowState.triggerFormUuid)?.name ?? "来源表单"}中的当前记录会作为触发数据。</p>
                      ) : <PropertyField label="触发表单">
                        <Select
                          aria-label="触发表单"
                          selectedKey={flowState.triggerFormUuid || "none"}
                          onSelectionChange={(key) =>
                            handleFlowFieldChange(
                              "triggerFormUuid",
                              String(key === "none" ? "" : (key ?? "")),
                            )
                          }
                        >
                          <Select.Trigger>
                            <Select.Value>
                              {forms.find(
                                (form) => form.id === flowState.triggerFormUuid,
                              )?.name ?? "选择触发表单"}
                            </Select.Value>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="none" textValue="未配置">
                                未配置
                              </ListBox.Item>
                              {forms.map((form) => (
                                <ListBox.Item
                                  key={form.id}
                                  id={form.id}
                                  textValue={form.name}
                                >
                                  {form.name}
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </PropertyField>}
                      {triggerEventRows.map((row) => {
                        const selectedEvent = row.events.find((event) =>
                          flowState.triggerEvents.includes(event),
                        );
                        const operationLabel = row.label.replace("成功", "");
                        return (
                          <PropertyField key={row.label} label={operationLabel}>
                            <Select
                              aria-label={`${operationLabel}触发时机`}
                              selectedKey={selectedEvent ?? "none"}
                              onSelectionChange={(key) => {
                                if (key === "none") {
                                  if (selectedEvent) {
                                    handleTriggerEventSelection(row.events, selectedEvent, false);
                                  }
                                } else {
                                  const event = row.events.find((event) => event === key);
                                  if (event) handleTriggerEventSelection(row.events, event, true);
                                }
                              }}
                            >
                              <Select.Trigger>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  <ListBox.Item id="none" textValue="不触发">
                                    不触发
                                  </ListBox.Item>
                                  {row.events.map((event) => {
                                    const label = event === "button_click"
                                      ? "点击按钮时"
                                      : `${operationLabel}${event.startsWith("before_") ? "前" : "后"}`;
                                    return (
                                      <ListBox.Item key={event} id={event} textValue={label}>
                                        {label}
                                      </ListBox.Item>
                                    );
                                  })}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                          </PropertyField>
                        );
                      })}
                    </>
                  )}
                </PropertyPanelSection>
              ) : null}

              {selectedNode.data.kind !== "trigger" ? (
                <PropertyPanelSection
                  title="节点基础"
                  description="节点名称和说明会显示在画布卡片中。"
                >
                  <PropertyField label="节点名称">
                    <Input
                      aria-label="节点名称"
                      placeholder="节点名称"
                      value={selectedNode.data.label}
                      onChange={(event) =>
                        handleNodeLabelChange(
                          "label",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </PropertyField>
                  <PropertyField label="节点说明" alignStart>
                    <TextArea
                      className="w-full"
                      placeholder="节点说明"
                      value={selectedNode.data.description}
                      onChange={(event) =>
                        handleNodeLabelChange(
                          "description",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </PropertyField>
                </PropertyPanelSection>
              ) : null}

              <NodeConfigFields
                nodes={nodes}
                edges={edges}
                onInitiateApprovalChange={(config) => updateSelectedNodeConfig(() => config)}
                appId={appId}
                forms={forms}
                getManySourceOptions={getManySourceOptions}
                updateSourceOptions={updateSourceOptions}
                updateTargetFormOptions={updateTargetFormOptions}
                multipleSourceFieldChoices={multipleSourceFieldChoices}
                node={selectedNode}
                getSchemaStatus={schemaStatus[selectedQueryFormUuid]}
                onRetryGetSchema={() => { if (selectedQueryFormUuid) void ensureFormSchema(selectedQueryFormUuid); }}
                getSourceOptions={buildGetSourceOptions(nodes, edges, selectedNodeId)}
                onGetFilterModeChange={(filterMode) => updateSelectedNodeConfig((config) => ({ ...normalizeGetDataConfig(config), filterMode }))}
                selectedSchema={selectedNodeSchema}
                sourceFieldChoices={sourceFieldChoices}
                triggerEvents={flowState.triggerEvents}
                triggerFieldOptions={triggerFieldOptions}
                members={members}
                roles={roles}
                onActionTargetFormChange={handleActionTargetFormChange}
                onAddDataConfigChange={handleAddDataConfigChange}
                onUpdateConfigChange={handleUpdateConfigChange}
                onUpdateSourceNodeChange={handleUpdateSourceNodeChange}
                onAddUpdateRule={handleAddUpdateRule}
                onRemoveUpdateRule={handleRemoveUpdateRule}
                onUpdateRuleChange={handleUpdateRuleChange}
                onAddMappingRow={handleAddMappingRow}
                onBasicChange={handleBasicNodeConfigChange}
                onProcessMemberIdsChange={handleProcessMemberIdsChange}
                onProcessRequiredFieldIdsChange={(ids) =>
                  updateSelectedNodeConfig((config) => ({
                    ...normalizeAssigneeConfig(config),
                    requiredFieldIds: ids,
                  }))
                }
                onConditionBranchChange={handleConditionBranchChange}
                onConditionModeChange={handleConditionModeChange}
                onMoveConditionBranch={handleMoveConditionBranch}
                onAddConditionBranch={() =>
                  handleAddConditionBranch(selectedNode.id)
                }
                onRemoveConditionBranch={(branchId) =>
                  handleRemoveConditionBranch(selectedNode.id, branchId)
                }
                onAddConditionRule={handleAddConditionRule}
                onRemoveConditionRule={handleRemoveConditionRule}
                onConditionRuleChange={handleConditionRuleChange}
                onGetNodeFormChange={handleGetNodeFormChange}
                onGetNodeSourceModeChange={handleGetNodeSourceModeChange}
                onGetNodeSourceNodeChange={handleGetNodeSourceNodeChange}
                onRemoveMappingRow={handleRemoveMappingRow}
                onRowChange={handleMappingRowChange}
              />
            </WorkflowNodeConfigDrawer>
          ) : null}
        </section>

        <AutomationNodeInsertModal
          isOpen={insertContext !== null}
          groups={dataNodeMenu}
          nodeTone={nodeTone}
          onOpenChange={(isOpen) => !isOpen && setInsertContext(null)}
          onSelect={handleInsertNode}
        />

        <AutomationNameModal
          isOpen={!isProcessFlow && isNameModalOpen}
          name={nameDraft}
          description={descriptionDraft}
          isSaving={isNameSaving}
          onOpenChange={setIsNameModalOpen}
          onNameChange={setNameDraft}
          onDescriptionChange={setDescriptionDraft}
          onSubmit={() => void submitName()}
        />

        <AutomationSchemaModal
          isOpen={isSchemaModalOpen}
          schema={automationSchema}
          onOpenChange={setIsSchemaModalOpen}
        />

        <AutomationVersionsModal
          isOpen={isVersionModalOpen}
          currentVersion={flowState.currentVersion}
          status={displayStatus}
          createdAt={flowState.createdAt}
          updatedAt={flowState.updatedAt}
          versions={versionItems}
          isLoading={isVersionsLoading}
          restoringVersion={restoringVersion}
          formatDate={formatDateLabel}
          onOpenChange={setIsVersionModalOpen}
          onRestore={(version) => void handleRestoreVersion(version)}
        />
      </div>
    </>
  );
}

function CanvasZoomControl({
  zoom,
  onZoomChange,
}: {
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const { zoomTo } = useReactFlow();
  const zoomPercent = Math.round(zoom * 100);

  return (
    <Slider
      aria-label="画布缩放"
      className="w-40 shrink-0 gap-1"
      minValue={50}
      maxValue={200}
      step={5}
      value={zoomPercent}
      onChange={(value) => {
        const nextZoom = Number(value) / 100;
        onZoomChange(nextZoom);
        void zoomTo(nextZoom);
      }}
    >
      <Label className="text-xs font-normal leading-4 tabular-nums text-[var(--color-text-secondary)]">
        {zoomPercent}%
      </Label>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  );
}
