"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type OnConnectEnd,
} from "@xyflow/react";
import { Button, Checkbox, Input, ListBox, Select, Slider, toast } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { Modal } from "@heroui/react/modal";
import {
  getAutomationFlow,
  getFormSchema,
  listDetailForms,
  listAutomationFlowVersions,
  listForms,
  listUsers,
  restoreAutomationFlowVersion,
  updateAutomationFlow,
  type ApiAutomationFlowVersionSummary,
  type ApiDetailForm,
  type ApiFormSummary,
  type UpdateAutomationFlowRequest,
} from "@/features/automation-editor/api";
import {
  AddIcon,
  ArrowLeftIcon,
  CodeIcon,
} from "../../../../../components/app-icons";
import {
  type TriggerEvent,
} from "../automation-shared";
import {
  automationWorkflowNodeRegistry,
  processWorkflowNodeRegistry,
} from "../automation-workflow-node-registry";
import {
  validateWorkflowGraph,
  validateWorkflowNodeConfigs,
} from "../../../../../components/workflow-editor/workflow-core";
import { WorkflowCanvas } from "../../../../../components/workflow-editor/workflow-canvas";
import { WorkflowNodeConfigDrawer } from "../../../../../components/workflow-editor/workflow-node-config-drawer";
import {
  InsertableEdge,
  NodeConfigFields,
  PropertyField,
  PropertyPanelSection,
  createWorkflowNode,
  getInsertedNodePosition,
  WorkflowCardNode,
  WorkflowNodeActionsContext,
  type WorkflowNodeActions,
} from "./automation-node-editor-components";
import {
  buildAutomationName,
  buildDataNodeFieldChoices,
  buildGetManySourceOptions,
  buildQueryNodeOptions,
  buildSourceFieldChoices,
  buildUpdateTargetFormOptions,
  collectSchemaTargets,
  conditionBranchHandleId,
  createBranchRule,
  createConditionBranch,
  createEditorEdge,
  createFieldMappingRow,
  defaultSourceHandleForNode,
  decorateEdges,
  ensureTriggerNode,
  formatDateLabel,
  getSchemaForNodeTarget,
  getSchemaFields,
  hasUpdateTriggerEvent,
  migrateConditionEdgeHandles,
  nodeKindLabel,
  nodeTone,
  normalizeActionConfig,
  normalizeAddDataConfig,
  normalizeAssigneeConfig,
  normalizeConditionConfig,
  normalizeCopyConfig,
  normalizeFormSchema,
  normalizeGetDataConfig,
  normalizeTriggerConfig,
  normalizeWorkflowEdges,
  normalizeWorkflowNodes,
  orderTriggerEvents,
  promoteRuleToChildGroup,
  serializeWorkflow,
  syncRequiredRows,
  syncTriggerNode,
  triggerEventRows,
  triggerDataNodeMenu,
  placeholderNodeGroups,
  processDataNodeMenu,
  type ActionConfig,
  type AddDataConfig,
  type BranchRule,
  type ConditionBranch,
  type DataSourceMode,
  type FieldMappingRow,
  type FlowState,
  type FormSchemaDescriptor,
  type InsertContext,
  type MemberOption,
  type PaletteNodeKind,
  type TriggerConfig,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeConfig,
} from "./automation-editor-model";

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
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const headerDescriptionRef = useRef<HTMLInputElement | null>(null);
  const [flowState, setFlowState] = useState<FlowState>({
    flowType: "trigger",
    name: "",
    description: "",
    status: "draft",
    currentVersion: 1,
    triggerFormUuid: "",
    triggerEvent: "after_create",
    triggerEvents: ["after_create"],
    triggerConfig: {},
  });
  const [members, setMembers] = useState<MemberOption[]>([]);
  useEffect(() => { void listUsers({ responseStyle: "fields" }).then((result) => { if (result.data?.code === 0 && result.data.data) setMembers(result.data.data.filter((user) => user.status === "active").map((user) => ({ id: user.id, displayName: user.displayName, status: user.status }))); }); }, []);
  const dataNodeMenu = flowState.flowType === "process" ? processDataNodeMenu : triggerDataNodeMenu;
  const [forms, setForms] = useState<ApiFormSummary[]>([]);
  const [detailForms, setDetailForms] = useState<ApiDetailForm[]>([]);
  const [formSchemas, setFormSchemas] = useState<Record<string, FormSchemaDescriptor>>({});
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [insertContext, setInsertContext] = useState<InsertContext | null>(null);
  const [isHeaderEditing, setIsHeaderEditing] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(0.9);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionItems, setVersionItems] = useState<ApiAutomationFlowVersionSummary[]>([]);
  const [isVersionsLoading, setIsVersionsLoading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");

  const handleInsertRequest = useCallback(
    (sourceId: string, targetId: string, edgeId: string) => {
      setInsertContext({ sourceId, targetId, edgeId });
    },
    [],
  );

  const handleAddConditionBranch = useCallback((nodeId: string) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId || node.data.kind !== "condition") {
          return node;
        }

        const config = normalizeConditionConfig(node.data.config);
        const branches = config.branches ?? [];
        const nextPriority = Math.max(0, ...branches.map((branch) => branch.priority)) + 1;
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              branches: [...branches, createConditionBranch(nextPriority)],
            },
          },
        };
      }),
    );
    setSelectedNodeId(nodeId);
  }, []);

  const handleRemoveConditionBranch = useCallback((nodeId: string, branchId: string) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId || node.data.kind !== "condition") {
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
              branches: config.branches?.filter((branch) => branch.id !== branchId),
            },
          },
        };
      }),
    );
    setEdges((current) =>
      current.filter(
        (edge) => !(edge.source === nodeId && edge.sourceHandle === conditionBranchHandleId(branchId)),
      ),
    );
  }, []);

  const workflowNodeActions = useMemo<WorkflowNodeActions>(
    () => ({
      addConditionBranch: handleAddConditionBranch,
      removeConditionBranch: handleRemoveConditionBranch,
    }),
    [handleAddConditionBranch, handleRemoveConditionBranch],
  );

  const ensureFormSchema = useCallback(async (formUuid: string) => {
    if (!formUuid) {
      return;
    }

    const result = await getFormSchema({
      path: { formUuid },
      responseStyle: "fields",
    });

    if (result.error || !result.data || result.data.code !== 0 || !result.data.data) {
      return;
    }

    const normalized = normalizeFormSchema(result.data.data.schema as Record<string, unknown>);
    setFormSchemas((current) => ({
      ...current,
      [formUuid]: normalized,
    }));
  }, []);

  const loadEditor = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

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

      if (
        detailResult.error ||
        !detailResult.data ||
        detailResult.data.code !== 0 ||
        !detailResult.data.data
      ) {
        throw new Error("load automation detail failed");
      }

      if (
        formsResult.error ||
        !formsResult.data ||
        formsResult.data.code !== 0 ||
        !formsResult.data.data
      ) {
        throw new Error("load forms failed");
      }

      const detail = detailResult.data.data;
      const nextFlowState: FlowState = {
        flowType: detail.flowType === "process" ? "process" : "trigger",
        name: detail.name,
        description: detail.description ?? "",
        status: detail.status,
        currentVersion: detail.currentVersion,
        triggerFormUuid: detail.triggerFormUuid ?? "",
        triggerEvent: detail.triggerEvent,
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
          migrateConditionEdgeHandles(normalizeWorkflowEdges(detail.edges), nextNodes),
          handleInsertRequest,
        ),
      );
      setSelectedNodeId(null);

      const schemaTargets = collectSchemaTargets(nextFlowState, nextNodes);
      if (schemaTargets.length > 0) {
        await Promise.all(schemaTargets.map((formUuid) => ensureFormSchema(formUuid)));
      }
    } catch {
      setErrorMessage("自动化详情加载失败，请确认后端服务正常。");
    } finally {
      setIsLoading(false);
    }
  }, [appId, automationId, ensureFormSchema, handleInsertRequest]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEditor();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadEditor]);

  useEffect(() => {
    if (!isHeaderEditing) {
      return;
    }

    headerDescriptionRef.current?.focus();
  }, [isHeaderEditing]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodeSchema =
    selectedNode?.data.kind === "add-data" || selectedNode?.data.kind === "update-data" || selectedNode?.data.kind === "delete-data"
      ? getSchemaForNodeTarget(selectedNode, formSchemas)
      : undefined;
  const sourceFieldChoices = buildSourceFieldChoices({
    currentNodeId: selectedNodeId,
    edges,
    formSchemas,
    flowState,
    nodes,
  });
  const triggerFieldOptions = flowState.triggerFormUuid
    ? formSchemas[flowState.triggerFormUuid]?.fields ?? []
    : [];
  const getManySourceOptions = buildGetManySourceOptions(nodes, edges, selectedNodeId);
  const updateSourceOptions = buildQueryNodeOptions(nodes);
  const updateTargetFormOptions = buildUpdateTargetFormOptions(forms, detailForms);
  const selectedAddDataConfig =
    selectedNode?.data.kind === "add-data"
      ? normalizeAddDataConfig(selectedNode.data.config)
      : null;
  const multipleSourceFieldChoices = selectedAddDataConfig?.multipleSourceNodeId
    ? buildDataNodeFieldChoices({
        formSchemas,
        nodeId: selectedAddDataConfig.multipleSourceNodeId,
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
    if (!connection.source || !connection.target || connection.target === "trigger-1") {
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

    const clientPoint = "changedTouches" in event
      ? event.changedTouches[0]
      : event;
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

  function handleFlowFieldChange<K extends keyof FlowState>(key: K, value: FlowState[K]) {
    setFlowState((current) => {
      const nextState = { ...current, [key]: value };
      if (key === "triggerFormUuid") {
        nextState.triggerConfig = {
          ...nextState.triggerConfig,
          changedFieldMode: "any",
          changedFieldId: "",
          changedFieldsText: "",
        };
      }
      setNodes((currentNodes) => syncTriggerNode(currentNodes, nextState, forms));
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
          ? [...current.triggerEvents.filter((item) => !events.includes(item)), event]
          : current.triggerEvents.filter((item) => item !== event),
      );
      const nextState = {
        ...current,
        triggerEvent: triggerEvents[0] ?? "after_create",
        triggerEvents,
        triggerConfig: hasUpdateTriggerEvent(triggerEvents)
          ? current.triggerConfig
          : {
              ...current.triggerConfig,
              changedFieldMode: "any" as const,
              changedFieldId: "",
              changedFieldsText: "",
            },
      };
      setNodes((currentNodes) => syncTriggerNode(currentNodes, nextState, forms));
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
        triggerConfig.changedFieldsText = "";
      }
      const nextState = {
        ...current,
        triggerConfig,
      };
      setNodes((currentNodes) => syncTriggerNode(currentNodes, nextState, forms));
      return nextState;
    });
  }

  function handleHeaderEditFinish() {
    setIsHeaderEditing(false);
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

      if (result.error || !result.data || result.data.code !== 0 || !result.data.data) {
        throw new Error("load automation versions failed");
      }

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
        throw new Error("restore automation version failed");
      }

      toast.success(`已恢复到 v${version}`);
      await openVersionModal();
      await loadEditor();
    } catch {
      toast.danger("恢复版本失败");
    } finally {
      setRestoringVersion(null);
    }
  }

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
    if (key === "assigneesText" && (selectedNode.data.kind === "approval" || selectedNode.data.kind === "executor")) {
      updateSelectedNodeConfig((config) => ({ ...normalizeAssigneeConfig(config), assignees: value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean) }));
      return;
    }
    if (key === "recipientsText" && selectedNode.data.kind === "copy") {
      updateSelectedNodeConfig((config) => ({ ...normalizeCopyConfig(config), recipients: value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean) }));
      return;
    }

    updateSelectedNodeConfig((config) => ({
      ...config,
      [key]: value,
    }));
  }

  function handleProcessMemberIdsChange(key: "assigneeIds" | "recipientIds", ids: string[]) {
    updateSelectedNodeConfig((config) => ({ ...config, [key]: ids }));
  }

  function handleGetNodeSourceModeChange(value: DataSourceMode) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeGetDataConfig(config);
      nextConfig.sourceMode = value;
      nextConfig.formUuid = value === "form" ? nextConfig.formUuid : "";
      nextConfig.dataNodeId = value === "data-node" ? nextConfig.dataNodeId : "";
      return nextConfig;
    });
  }

  function handleGetNodeFormChange(formUuid: string) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeGetDataConfig(config);
      nextConfig.formUuid = formUuid;
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
      return nextConfig;
    });
  }

  function handleActionTargetFormChange(formUuid: string) {
    updateSelectedNodeConfig((config) => {
      if (selectedNode?.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(config);
        nextConfig.targetFormUuid = formUuid;
        nextConfig.rows = syncRequiredRows(
          nextConfig.rows ?? [],
          formSchemas[formUuid]?.fields ?? [],
        );
        return nextConfig;
      }

      if (selectedNode?.data.kind === "update-data") {
        const nextConfig = normalizeActionConfig(config);
        nextConfig.targetFormUuid = formUuid;
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

      if (key === "recordMode" && value === "single") {
        nextConfig.rows = syncRequiredRows(
          nextConfig.rows ?? [],
          getSchemaFields(nextConfig.targetFormUuid, formSchemas),
        );
      }

      return nextConfig;
    });
  }

  function handleUpdateConfigChange<K extends keyof ActionConfig>(
    key: K,
    value: ActionConfig[K],
  ) {
    updateSelectedNodeConfig((config) => ({
      ...normalizeActionConfig(config),
      [key]: value,
    }));
  }

  function handleUpdateSourceNodeChange(sourceNodeId: string) {
    const sourceNode = nodes.find(
      (node) =>
        node.id === sourceNodeId &&
        (node.data.kind === "get-one" || node.data.kind === "get-many"),
    );
    const sourceConfig = sourceNode
      ? normalizeGetDataConfig(sourceNode.data.config)
      : null;
    const targetFormUuid = sourceConfig?.formUuid ?? "";

    updateSelectedNodeConfig((config) => ({
      ...normalizeActionConfig(config),
      sourceNodeId,
      targetFormUuid,
    }));

    if (targetFormUuid) {
      void ensureFormSchema(targetFormUuid);
    }
  }

  function handleUpdateRuleChange(
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeActionConfig(config);
      const changedRule = (nextConfig.rules ?? []).find((rule) => rule.id === ruleId);
      nextConfig.rules = (nextConfig.rules ?? []).map((rule) => {
        // A condition level has one logical operator. Keep every sibling in sync
        // because the persisted rule shape stores that operator on each item.
        if (key === "logicalOperator" && rule.parentId === changedRule?.parentId) {
          return { ...rule, logicalOperator: value as "and" | "or" };
        }
        if (rule.id !== ruleId) return rule;
        const nextRule = { ...rule, [key]: value };
        if (key === "fieldKey") {
          nextRule.rawValue = "";
        }
        if (key === "operator" && (value === "hasValue" || value === "noValue")) {
          nextRule.rawValue = "";
        }
        return nextRule;
      });
      return nextConfig;
    });
  }

  function handleAddUpdateRule(parentId?: string, siblingOfId?: string, count = 1) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeActionConfig(config);
      const rules = [...(nextConfig.rules ?? [])];
      if (count === 0 && parentId) {
        nextConfig.rules = promoteRuleToChildGroup(rules, parentId);
        return nextConfig;
      }
      const nextRules = Array.from({ length: count }, () => createBranchRule(parentId));
      if (!siblingOfId) {
        nextConfig.rules = [...rules, ...nextRules];
        return nextConfig;
      }
      const siblingIndex = rules.findIndex((rule) => rule.id === siblingOfId);
      if (siblingIndex === -1) {
        nextConfig.rules = [...rules, ...nextRules];
        return nextConfig;
      }
      rules.splice(siblingIndex + 1, 0, ...nextRules);
      nextConfig.rules = rules;
      return nextConfig;
    });
  }

  function handleRemoveUpdateRule(ruleId: string) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeActionConfig(config);
      nextConfig.rules = (nextConfig.rules ?? []).filter((rule) => rule.id !== ruleId);
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
    key: "name" | "hitLabel" | "expression",
    value: string,
  ) {
    updateSelectedConditionBranch(branchId, (branch) => ({
      ...branch,
      [key]: value,
    }));
  }

  function handleConditionModeChange(
    branchId: string,
    value: "all" | "rules" | "expression",
  ) {
    updateSelectedConditionBranch(branchId, (branch) => {
      const rules = value === "rules" && branch.rules.length === 0
        ? [createBranchRule()]
        : branch.rules;
      return { ...branch, mode: value, rules };
    });
  }

  function handleMoveConditionBranch(branchId: string, direction: "up" | "down") {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeConditionConfig(config);
      const branches = [...(nextConfig.branches ?? [])];
      const currentIndex = branches.findIndex((branch) => branch.id === branchId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= branches.length) {
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
      const nextRules = Array.from({ length: count }, () => createBranchRule(parentId));
      const rules = [...branch.rules];
      if (count === 0 && parentId) {
        return { ...branch, rules: promoteRuleToChildGroup(rules, parentId) };
      }

      if (!siblingOfId) {
        return { ...branch, rules: [...rules, ...nextRules] };
      }

      const index = rules.findIndex((item) => item.id === siblingOfId);
      if (index === -1) {
        return { ...branch, rules: [...rules, ...nextRules] };
      }

      rules.splice(index + 1, 0, ...nextRules);
      return { ...branch, rules };
    });
  }

  function handleRemoveConditionRule(branchId: string, ruleId: string) {
    updateSelectedConditionBranch(branchId, (branch) => {
      const rules = branch.rules;
      const removeIds = new Set<string>([ruleId]);

      let changed = true;
      while (changed) {
        changed = false;
        for (const rule of rules) {
          if (rule.parentId && removeIds.has(rule.parentId) && !removeIds.has(rule.id)) {
            removeIds.add(rule.id);
            changed = true;
          }
        }
      }

      return {
        ...branch,
        rules: rules.filter((item) => !removeIds.has(item.id)),
      };
    });
  }

  function handleConditionRuleChange(
    branchId: string,
    ruleId: string,
    key: keyof BranchRule,
    value: string,
  ) {
    updateSelectedConditionBranch(branchId, (branch) => {
      const changedRule = branch.rules.find((rule) => rule.id === ruleId);
      const rules = branch.rules.map((rule) => {
        // A condition level has one logical operator. Keep every sibling in sync
        // because the persisted rule shape stores that operator on each item.
        if (key === "logicalOperator" && rule.parentId === changedRule?.parentId) {
          return { ...rule, logicalOperator: value as "and" | "or" };
        }
        if (rule.id !== ruleId) return rule;

        const nextRule = { ...rule, [key]: value };
        if (key === "fieldKey") {
          nextRule.rawValue = "";
        }
        if (key === "valueType") {
          nextRule.rawValue = "";
          nextRule.sourceFieldKey = "";
        }
        if (key === "operator" && (value === "hasValue" || value === "noValue")) {
          nextRule.rawValue = "";
        }
        return nextRule;
      });
      return { ...branch, rules };
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
          ? normalizeAddDataConfig(config).rows ?? []
          : selectedNode?.data.kind === "update-data"
            ? normalizeActionConfig(config).rows ?? []
            : [];
      const nextRows = nextRowsSource.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        const nextRow = { ...row, [key]: value };
        if (key === "fieldId") {
          nextRow.rawValue = "";
          nextRow.sourceFieldKey = "";
          nextRow.formula = "";
          nextRow.valueType = "value";
        }
        if (key === "valueType") {
          nextRow.rawValue = "";
          nextRow.sourceFieldKey = "";
          nextRow.formula = "";
        }
        return nextRow;
      });
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
      (selectedNode.data.kind !== "add-data" && selectedNode.data.kind !== "update-data")
    ) {
      return;
    }

    const config = selectedNode.data.kind === "add-data"
      ? normalizeAddDataConfig(selectedNode.data.config)
      : normalizeActionConfig(selectedNode.data.config);
    const targetFields = getSchemaFields(config.targetFormUuid, formSchemas);
    const usedFieldIds = new Set((config.rows ?? []).map((row) => row.fieldId));
    const candidate = targetFields.find((field) => !usedFieldIds.has(field.id));

    if (!candidate) {
      return;
    }

    updateSelectedNodeConfig((current) => {
      if (selectedNode.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(current);
        nextConfig.rows = [
          ...(nextConfig.rows ?? []),
          createFieldMappingRow(candidate.id),
        ];
        return nextConfig;
      }
      const nextConfig = normalizeActionConfig(current);
      nextConfig.rows = [
        ...(nextConfig.rows ?? []),
        createFieldMappingRow(candidate.id),
      ];
      return nextConfig;
    });
  }

  function handleRemoveMappingRow(rowId: string) {
    if (
      !selectedNode ||
      (selectedNode.data.kind !== "add-data" && selectedNode.data.kind !== "update-data")
    ) {
      return;
    }

    const config = selectedNode.data.kind === "add-data"
      ? normalizeAddDataConfig(selectedNode.data.config)
      : normalizeActionConfig(selectedNode.data.config);
    const targetFields = getSchemaFields(config.targetFormUuid, formSchemas);
    const row = (config.rows ?? []).find((item) => item.id === rowId);
    const field = targetFields.find((item) => item.id === row?.fieldId);

    if (selectedNode.data.kind === "add-data" && field?.isRequired) {
      return;
    }

    updateSelectedNodeConfig((current) => {
      if (selectedNode.data.kind === "add-data") {
        const nextConfig = normalizeAddDataConfig(current);
        nextConfig.rows = (nextConfig.rows ?? []).filter((item) => item.id !== rowId);
        return nextConfig;
      }
      const nextConfig = normalizeActionConfig(current);
      nextConfig.rows = (nextConfig.rows ?? []).filter((item) => item.id !== rowId);
      return nextConfig;
    });
  }

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

    setNodes((current) => current.filter((node) => node.id !== selectedNode.id));
    setEdges((current) =>
      decorateEdges(
        current.filter(
          (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
        ),
        handleInsertRequest,
      ),
    );
    setSelectedNodeId(null);
  }

  function handleSaveFlow() {
    setErrorMessage("");

    startTransition(async () => {
      try {
        const synchronizedNodes = syncTriggerNode(nodes, flowState, forms);
        const validationIssues = validateWorkflowGraph(synchronizedNodes, edges, {
          rootKinds: (flowState.flowType === "process" ? processWorkflowNodeRegistry : automationWorkflowNodeRegistry)
            .filter((definition) => definition.isRoot)
            .map((definition) => definition.kind),
        });
        if (validationIssues.some((issue) => issue.severity === "error")) {
          setErrorMessage("工作流存在无效入口、失效连线或循环依赖，无法保存。");
          return;
        }
        const configIssues = validateWorkflowNodeConfigs(
          synchronizedNodes,
          flowState.flowType === "process" ? processWorkflowNodeRegistry : automationWorkflowNodeRegistry,
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
          setErrorMessage(configIssues.find((issue) => issue.severity === "error")?.message ?? "节点配置不完整，无法启用。");
          return;
        }
        const payload = serializeWorkflow(synchronizedNodes, edges);
        const { data, error } = await updateAutomationFlow({
          path: { automationId },
          body: {
            name:
              flowState.name.trim() ||
              buildAutomationName(forms, flowState.triggerFormUuid),
            description: flowState.description.trim() || undefined,
            status: flowState.status,
            triggerFormUuid: flowState.triggerFormUuid || undefined,
            triggerEvents: flowState.triggerEvents,
            triggerConfig: flowState.triggerConfig,
            nodes: payload.nodes,
            edges: payload.edges,
          } as UpdateAutomationFlowRequest & { triggerEvents?: TriggerEvent[] },
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("save automation flow failed");
        }

        setNodes(synchronizedNodes);
        toast.success("工作流已保存");
      } catch {
        setErrorMessage("保存自动化编排失败。");
      }
    });
  }

  const automationSchema = useMemo(() => {
    const synchronizedNodes = syncTriggerNode(nodes, flowState, forms);
    const workflow = serializeWorkflow(synchronizedNodes, edges);

    return JSON.stringify(
      {
        automationId,
        name: flowState.name || buildAutomationName(forms, flowState.triggerFormUuid),
        description: flowState.description || undefined,
        status: flowState.status,
        currentVersion: flowState.currentVersion,
        triggerFormUuid: flowState.triggerFormUuid || undefined,
        triggerEvent: flowState.triggerEvent,
        triggerEvents: flowState.triggerEvents,
        triggerConfig: flowState.triggerConfig,
        ...workflow,
      },
      null,
      2,
    );
  }, [automationId, edges, flowState, forms, nodes]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10 text-sm text-[var(--color-text-secondary)]">
        正在加载自动化编排...
      </div>
    );
  }

  const displayStatus = flowState.status === "enabled" ? "enabled" : "paused";

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 text-[var(--color-text-primary)] shadow-[var(--shadow-designer)]">
      <header
        className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-5 py-2 backdrop-blur lg:px-6"
        onPointerDown={() => setSelectedNodeId(null)}
      >
        <div className="mx-auto flex w-full items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              href={`/${appId}/automations`}
              className="inline-flex shrink-0 items-center gap-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              <ArrowLeftIcon />
              返回自动化列表
            </Link>
            <div
              className="min-w-0 max-w-[720px] flex-1 rounded-xl border border-transparent px-1 py-1 transition hover:border-[var(--color-border)]"
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsHeaderEditing(true);
              }}
            >
              {isHeaderEditing ? (
                <div
                  className="flex min-w-0 items-center gap-2"
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      handleHeaderEditFinish();
                    }
                  }}
                >
                  <Input
                    aria-label="工作流名称"
                    className="h-9 min-h-9 w-[min(280px,40%)] min-w-0"
                    placeholder="工作流名称"
                    value={flowState.name}
                    onChange={(event) =>
                      handleFlowFieldChange("name", event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleHeaderEditFinish();
                    }}
                  />
                  <Input
                    ref={headerDescriptionRef}
                    aria-label="工作流说明"
                    className="h-9 min-h-9 min-w-0 flex-1"
                    placeholder="工作流说明"
                    value={flowState.description}
                    onChange={(event) =>
                      handleFlowFieldChange("description", event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleHeaderEditFinish();
                    }}
                  />
                </div>
              ) : (
                <div className="flex min-w-0 items-baseline gap-3">
                  <h1 className="max-w-[320px] shrink-0 truncate text-lg font-semibold text-[var(--color-text-primary)]">
                    {flowState.name || "未命名工作流"}
                  </h1>
                  <p className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-secondary)]">
                    {flowState.description || "双击编辑工作流名称和说明"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <CanvasZoomControl zoom={canvasZoom} onZoomChange={setCanvasZoom} />
            <Button
              isIconOnly
              aria-label="查看自动化 Schema"
              variant="ghost"
              className="!h-9 !min-h-9 !w-9 !min-w-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setIsSchemaModalOpen(true)}
            >
              <CodeIcon />
            </Button>
            <div
              className="inline-flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] p-1"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button
                variant="ghost"
                className={[
                  "!h-7 !min-h-7 rounded-md px-4 !text-xs",
                  displayStatus === "enabled"
                    ? "bg-[var(--color-primary)] text-[var(--color-text-on-primary)]"
                    : "bg-transparent text-[var(--color-text-secondary)]",
                ].join(" ")}
                onClick={() => handleStatusToggle("enabled")}
              >
                启用
              </Button>
              <Button
                variant="ghost"
                className={[
                  "!h-7 !min-h-7 rounded-md px-4 !text-xs",
                  displayStatus === "paused"
                    ? "bg-[var(--color-control-selected)] text-[var(--color-text-primary)]"
                    : "bg-transparent text-[var(--color-text-secondary)]",
                ].join(" ")}
                onClick={() => handleStatusToggle("paused")}
              >
                禁用
              </Button>
            </div>
            <Button
              variant="ghost"
              className="!h-9 !min-h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 !text-xs text-[var(--color-text-primary)]"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void openVersionModal()}
            >
              版本管理
            </Button>
            <Button
              variant="ghost"
              className="!h-9 !min-h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 !text-xs text-[var(--color-text-primary)]"
              onClick={() => router.push(`/${appId}/automations`)}
            >
              返回
            </Button>
            <Button
              className="!h-9 !min-h-9 rounded-lg bg-[var(--color-primary)] px-4 !text-xs text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)]"
              onClick={handleSaveFlow}
              isDisabled={isSaving}
            >
              保存编排
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 w-full flex-1">
        <section className="relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top,var(--color-bg-subtle)_0%,var(--color-bg-surface)_42%,var(--color-bg-canvas)_100%)]">
          {errorMessage ? (
            <div className="absolute left-5 right-5 top-5 z-30 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)] shadow-[var(--shadow-floating)]">
              {errorMessage}
            </div>
          ) : null}
          <WorkflowNodeActionsContext.Provider value={workflowNodeActions}>
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
              onDelete={selectedNode.data.kind !== "trigger" ? handleDeleteSelectedNode : undefined}
            >
                {selectedNode.data.kind === "trigger" ? (
                  <PropertyPanelSection title={flowState.flowType === "process" ? "流程起点" : "触发配置"} description="工作流名称和说明在左上角双击编辑。">
                    {flowState.flowType === "process" ? <div className="rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)]">表单提交时</div> : <>
                    <PropertyField label="触发表单">
                      <Select
                        aria-label="触发表单"
                        selectedKey={flowState.triggerFormUuid || "none"}
                        onSelectionChange={(key) =>
                          handleFlowFieldChange(
                            "triggerFormUuid",
                            String(key === "none" ? "" : key ?? ""),
                          )
                        }
                      >
                        <Select.Trigger>
                          <Select.Value>
                            {forms.find((form) => form.id === flowState.triggerFormUuid)?.name ??
                              "选择触发表单"}
                          </Select.Value>
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="none" textValue="未配置">
                              未配置
                            </ListBox.Item>
                            {forms.map((form) => (
                              <ListBox.Item key={form.id} id={form.id} textValue={form.name}>
                                {form.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </PropertyField>
                    <PropertyField label="触发事件" alignStart>
                      <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
                        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-xs font-medium text-[var(--color-text-secondary)]">
                          <span className="px-3 py-2">类型</span>
                          <span className="px-3 py-2">前</span>
                          <span className="px-3 py-2">后</span>
                        </div>
                        {triggerEventRows.map((row) => (
                          <div
                            key={row.label}
                            className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center border-b border-[var(--color-border)] last:border-b-0"
                          >
                            <span className="px-3 py-2 text-sm text-[var(--color-text-primary)]">{row.label}</span>
                            {row.events.map((event) => (
                              <Checkbox
                                key={event}
                                isSelected={flowState.triggerEvents.includes(event)}
                                onChange={(selected) =>
                                  handleTriggerEventSelection(row.events, event, selected)
                                }
                                className="px-3 py-2"
                              >
                                <Checkbox.Content className="sr-only"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{event}</Checkbox.Content>
                              </Checkbox>
                            ))}
                          </div>
                        ))}
                        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]">
                          <span className="px-3 py-2 text-sm">评论成功</span>
                          <span className="px-3 py-2">-</span>
                          <span className="px-3 py-2">-</span>
                        </div>
                      </div>
                    </PropertyField>
                    </>}
                  </PropertyPanelSection>
                ) : null}

                {selectedNode.data.kind !== "trigger" ? (
                  <PropertyPanelSection title="节点基础" description="节点名称和说明会显示在画布卡片中。">
                    <PropertyField label="节点名称">
                      <Input
                        aria-label="节点名称"
                        placeholder="节点名称"
                        value={selectedNode.data.label}
                        onChange={(event) =>
                          handleNodeLabelChange("label", event.currentTarget.value)
                        }
                      />
                    </PropertyField>
                    <PropertyField label="节点说明" alignStart>
                      <textarea
                        className="min-h-[64px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
                        placeholder="节点说明"
                        value={selectedNode.data.description}
                        onChange={(event) =>
                          handleNodeLabelChange("description", event.currentTarget.value)
                        }
                      />
                    </PropertyField>
                  </PropertyPanelSection>
                ) : null}

                <NodeConfigFields
                  forms={forms}
                  getManySourceOptions={getManySourceOptions}
                  updateSourceOptions={updateSourceOptions}
                  updateTargetFormOptions={updateTargetFormOptions}
                  multipleSourceFieldChoices={multipleSourceFieldChoices}
                  node={selectedNode}
                  selectedSchema={selectedNodeSchema}
                  sourceFieldChoices={sourceFieldChoices}
                  triggerEvents={flowState.triggerEvents}
                  triggerFieldOptions={triggerFieldOptions}
                  members={members}
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
                  onConditionBranchChange={handleConditionBranchChange}
                  onConditionModeChange={handleConditionModeChange}
                  onMoveConditionBranch={handleMoveConditionBranch}
                  onAddConditionBranch={() => handleAddConditionBranch(selectedNode.id)}
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
      </div>

      <Modal isOpen={insertContext !== null} onOpenChange={(isOpen) => !isOpen && setInsertContext(null)}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="cover">
            <Modal.Dialog data-node-insert-modal="true" className="w-[min(720px,92vw)] rounded-2xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  选择要插入的节点
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="max-h-[72vh] space-y-5 overflow-auto px-5 py-5">
                {dataNodeMenu.map((group) => (
                  <section key={group.group}>
                    <div className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">{group.group}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.items.map((item) => (
                        <button
                          key={item.kind}
                          type="button"
                          onClick={() => handleInsertNode(item.kind)}
                          className="flex min-h-[72px] items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3 text-left transition hover:border-[var(--color-primary)] hover:bg-[var(--color-control-soft-hover)]"
                        >
                          <span
                            className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${nodeTone[item.kind]}`}
                          >
                            <AddIcon />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                              {item.label}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">
                              {item.description}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}

                {placeholderNodeGroups.map((group) => (
                  <section key={group.group}>
                    <div className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">{group.group}</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.items.map((item) => (
                        <div
                          key={item}
                          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3 text-sm text-[var(--color-text-disabled)]"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal isOpen={isSchemaModalOpen} onOpenChange={setIsSchemaModalOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="cover">
            <Modal.Dialog className="flex h-[min(720px,86vh)] w-[min(920px,94vw)] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold">自动化 Schema</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭 Schema 查看器" />
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 overflow-hidden p-4">
                <textarea
                  readOnly
                  aria-label="自动化 Schema"
                  className="h-full min-h-0 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-code-bg)] p-4 font-mono text-xs leading-6 text-[#d9e2f2] outline-none"
                  value={automationSchema}
                />
              </Modal.Body>
              <Modal.Footer className="border-t border-[var(--color-border)] px-5 py-3">
                <Button variant="ghost" onPress={() => setIsSchemaModalOpen(false)}>
                  关闭
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal isOpen={isVersionModalOpen} onOpenChange={setIsVersionModalOpen}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="cover">
            <Modal.Dialog className="w-[min(640px,92vw)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  版本管理
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4 px-5 py-5">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">当前版本</div>
                  <div className="mt-2 text-sm text-[var(--color-text-primary)]">
                    v{flowState.currentVersion ?? 1}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    当前状态：{displayStatus === "enabled" ? "启用" : "禁用"}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    最新保存时间：{formatDateLabel(flowState.updatedAt)}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    创建时间：{formatDateLabel(flowState.createdAt)}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4">
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">历史版本</div>
                  {isVersionsLoading ? (
                    <div className="mt-3 text-sm text-[var(--color-text-secondary)]">正在加载版本...</div>
                  ) : versionItems.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {versionItems.map((item) => (
                        <div
                          key={item.version}
                          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-canvas)] px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                {`v${item.version} · ${item.name}`}
                              </div>
                              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.status}</div>
                            </div>
                            <Button
                              variant="ghost"
                              className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 text-[var(--color-text-primary)] disabled:opacity-50"
                              isDisabled={
                                restoringVersion === item.version ||
                                item.version === (flowState.currentVersion ?? 1)
                              }
                              onClick={() => void handleRestoreVersion(item.version)}
                            >
                              {item.version === (flowState.currentVersion ?? 1)
                                ? "当前版本"
                                : restoringVersion === item.version
                                  ? "恢复中"
                                  : "恢复"}
                            </Button>
                          </div>
                          <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                            {`${item.createdBy} · ${formatDateLabel(item.createdAt)}`}
                          </div>
                          {item.changeSummary ? (
                            <div className="mt-2 text-sm text-[var(--color-text-primary)]">
                              {item.changeSummary}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-[var(--color-text-secondary)]">暂无版本记录</div>
                  )}
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
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
    <div
      className="flex h-9 w-40 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Slider
        aria-label="画布缩放"
        className="min-w-0 flex-1"
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
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      <output className="w-9 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-secondary)]">
        {zoomPercent}%
      </output>
    </div>
  );
}
