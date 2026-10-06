"use client";
import { notify } from "@lib/notify";

import { createPortal } from "react-dom";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
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
import {
  Button,
  Checkbox,
  Input,
  ListBox,
  Select,
  Slider,
  Switch,
  Label,
} from "@heroui/react";
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
  Code as CodeIcon,
  Clock as VersionIcon,
  FloppyDisk as SaveIcon,
  Pencil as EditIcon,
  Check as EnabledIcon,
  Xmark as DisabledIcon,
} from "@gravity-ui/icons";
import { AutomationNameModal } from "./modals/AutomationNameModal";
import { AutomationNodeInsertModal } from "./modals/AutomationNodeInsertModal";
import { AutomationSchemaModal } from "./modals/AutomationSchemaModal";
import { AutomationVersionsModal } from "./modals/AutomationVersionsModal";
import { type TriggerEvent } from "../../components/AutomationShared";
import {
  automationWorkflowNodeRegistry,
  processWorkflowNodeRegistry,
} from "../../components/AutomationWorkflowNodeRegistry";
import {
  validateWorkflowGraph,
  validateWorkflowNodeConfigs,
} from "@components/workflow-editor/workflow-core";
import { WorkflowCanvas } from "@components/workflow-editor/WorkflowCanvas";
import { useAppHeaderActions } from "../../../components/AppShell";
import {
  AUTOMATION_TITLE_CHANGED_EVENT,
  type AutomationTitleChangedDetail,
} from "../../../components/automation-title-events";
import { WorkflowNodeConfigDrawer } from "@components/workflow-editor/WorkflowNodeConfigDrawer";
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
} from "./AutomationNodeEditorComponents";
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
} from "../automation-editor-model";

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
    triggerEvent: "after_create",
    triggerEvents: ["after_create"],
    triggerConfig: {},
  });
  const [members, setMembers] = useState<MemberOption[]>([]);
  useEffect(() => {
    void listUsers({ responseStyle: "fields" }).then((result) => {
      if (result.data?.code === 0 && result.data.data)
        setMembers(
          result.data.data
            .filter((user) => user.status === "active")
            .map((user) => ({
              id: user.id,
              displayName: user.displayName,
              status: user.status,
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
  const [nameError, setNameError] = useState("");
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
  const [errorMessage, setErrorMessage] = useState("");
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
        if (node.id !== nodeId || node.data.kind !== "condition") {
          return node;
        }

        const config = normalizeConditionConfig(node.data.config);
        const branches = config.branches ?? [];
        const nextPriority =
          Math.max(0, ...branches.map((branch) => branch.priority)) + 1;
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

  const handleRemoveConditionBranch = useCallback(
    (nodeId: string, branchId: string) => {
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

  const ensureFormSchema = useCallback(async (formUuid: string) => {
    if (!formUuid) {
      return;
    }

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
      return;
    }

    const normalized = normalizeFormSchema(
      result.data.data.schema as Record<string, unknown>,
    );
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
          migrateConditionEdgeHandles(
            normalizeWorkflowEdges(detail.edges),
            nextNodes,
          ),
          handleInsertRequest,
        ),
      );
      setSelectedNodeId(null);

      const schemaTargets = collectSchemaTargets(nextFlowState, nextNodes);
      if (schemaTargets.length > 0) {
        await Promise.all(
          schemaTargets.map((formUuid) => ensureFormSchema(formUuid)),
        );
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

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedNodeSchema =
    selectedNode?.data.kind === "add-data" ||
    selectedNode?.data.kind === "update-data" ||
    selectedNode?.data.kind === "delete-data"
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
    ? (formSchemas[flowState.triggerFormUuid]?.fields ?? [])
    : [];
  const getManySourceOptions = buildGetManySourceOptions(
    nodes,
    edges,
    selectedNodeId,
  );
  const updateSourceOptions = buildQueryNodeOptions(nodes);
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
          changedFieldsText: "",
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
              ...current.triggerEvents.filter((item) => !events.includes(item)),
              event,
            ]
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
        triggerConfig.changedFieldsText = "";
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
    setNameDraft(flowState.name);
    setDescriptionDraft(flowState.description);
    setNameError("");
    setIsNameModalOpen(true);
  }

  async function submitName() {
    const name = nameDraft.trim();
    if (!name) {
      setNameError("请输入自动化名称");
      return;
    }

    setIsNameSaving(true);
    setNameError("");
    try {
      const { data, error } = await updateAutomationFlow({
        path: { automationId },
        body: { name, description: descriptionDraft.trim() || null },
        responseStyle: "fields",
      });
      if (error || data?.code !== 0 || !data?.data) {
        throw new Error(data?.message || "更新自动化名称失败");
      }
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
      setNameError(
        cause instanceof Error ? cause.message : "更新自动化名称失败",
      );
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

      if (
        result.error ||
        !result.data ||
        result.data.code !== 0 ||
        !result.data.data
      ) {
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

      notify.success(`已切换到 v${version}`);
      await openVersionModal();
      await loadEditor();
    } catch {
      notify.error("切换版本失败");
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
    if (
      key === "assigneesText" &&
      (selectedNode.data.kind === "approval" ||
        selectedNode.data.kind === "executor")
    ) {
      updateSelectedNodeConfig((config) => ({
        ...normalizeAssigneeConfig(config),
        assignees: value
          .split(/[，,\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
      }));
      return;
    }
    if (key === "recipientsText" && selectedNode.data.kind === "copy") {
      updateSelectedNodeConfig((config) => ({
        ...normalizeCopyConfig(config),
        recipients: value
          .split(/[，,\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
      }));
      return;
    }

    updateSelectedNodeConfig((config) => ({
      ...config,
      [key]: value,
    }));
  }

  function handleProcessMemberIdsChange(
    key: "assigneeIds" | "recipientIds",
    ids: string[],
  ) {
    updateSelectedNodeConfig((config) => ({ ...config, [key]: ids }));
  }

  function handleGetNodeSourceModeChange(value: DataSourceMode) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeGetDataConfig(config);
      nextConfig.sourceMode = value;
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
      const changedRule = (nextConfig.rules ?? []).find(
        (rule) => rule.id === ruleId,
      );
      nextConfig.rules = (nextConfig.rules ?? []).map((rule) => {
        // A condition level has one logical operator. Keep every sibling in sync
        // because the persisted rule shape stores that operator on each item.
        if (
          key === "logicalOperator" &&
          rule.parentId === changedRule?.parentId
        ) {
          return { ...rule, logicalOperator: value as "and" | "or" };
        }
        if (rule.id !== ruleId) return rule;
        const nextRule = { ...rule, [key]: value };
        if (key === "fieldKey") {
          nextRule.rawValue = "";
        }
        if (
          key === "operator" &&
          (value === "hasValue" || value === "noValue")
        ) {
          nextRule.rawValue = "";
        }
        return nextRule;
      });
      return nextConfig;
    });
  }

  function handleAddUpdateRule(
    parentId?: string,
    siblingOfId?: string,
    count = 1,
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeActionConfig(config);
      const rules = [...(nextConfig.rules ?? [])];
      if (count === 0 && parentId) {
        nextConfig.rules = promoteRuleToChildGroup(rules, parentId);
        return nextConfig;
      }
      const nextRules = Array.from({ length: count }, () =>
        createBranchRule(parentId),
      );
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
      nextConfig.rules = (nextConfig.rules ?? []).filter(
        (rule) => rule.id !== ruleId,
      );
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
      const rules =
        value === "rules" && branch.rules.length === 0
          ? [createBranchRule()]
          : branch.rules;
      return { ...branch, mode: value, rules };
    });
  }

  function handleMoveConditionBranch(
    branchId: string,
    direction: "up" | "down",
  ) {
    updateSelectedNodeConfig((config) => {
      const nextConfig = normalizeConditionConfig(config);
      const branches = [...(nextConfig.branches ?? [])];
      const currentIndex = branches.findIndex(
        (branch) => branch.id === branchId,
      );
      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (
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
      const nextRules = Array.from({ length: count }, () =>
        createBranchRule(parentId),
      );
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
          if (
            rule.parentId &&
            removeIds.has(rule.parentId) &&
            !removeIds.has(rule.id)
          ) {
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
        if (
          key === "logicalOperator" &&
          rule.parentId === changedRule?.parentId
        ) {
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
        if (
          key === "operator" &&
          (value === "hasValue" || value === "noValue")
        ) {
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
          ? (normalizeAddDataConfig(config).rows ?? [])
          : selectedNode?.data.kind === "update-data"
            ? (normalizeActionConfig(config).rows ?? [])
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
      (selectedNode.data.kind !== "add-data" &&
        selectedNode.data.kind !== "update-data")
    ) {
      return;
    }

    const config =
      selectedNode.data.kind === "add-data"
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
      (selectedNode.data.kind !== "add-data" &&
        selectedNode.data.kind !== "update-data")
    ) {
      return;
    }

    const config =
      selectedNode.data.kind === "add-data"
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
        nextConfig.rows = (nextConfig.rows ?? []).filter(
          (item) => item.id !== rowId,
        );
        return nextConfig;
      }
      const nextConfig = normalizeActionConfig(current);
      nextConfig.rows = (nextConfig.rows ?? []).filter(
        (item) => item.id !== rowId,
      );
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
    setErrorMessage("");

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
          setErrorMessage("工作流存在无效入口、失效连线或循环依赖，无法保存。");
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
          setErrorMessage(
            configIssues.find((issue) => issue.severity === "error")?.message ??
              "节点配置不完整，无法启动。",
          );
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
        const savedFlow = data.data;
        setFlowState((current) => ({
          ...current,
          currentVersion: savedFlow.currentVersion,
          updatedAt: savedFlow.updatedAt,
        }));
        notify.success("工作流已保存");
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
        name:
          flowState.name ||
          buildAutomationName(forms, flowState.triggerFormUuid),
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

  const displayStatus = flowState.status === "enabled" ? "enabled" : "paused";

  const headerActions = (
    <div
      className="flex items-center gap-2"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className="whitespace-nowrap text-xs leading-none text-[var(--color-text-secondary)]">
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
      <Button variant="secondary" onPress={() => setIsSchemaModalOpen(true)}>
        <CodeIcon />
        Schema
      </Button>
      <Button variant="secondary" onPress={() => void openVersionModal()}>
        <VersionIcon />
        版本
      </Button>
      <Button variant="secondary" onPress={openNameModal}>
        <EditIcon />
        编辑名称
      </Button>
      <Button variant="primary" onPress={handleSaveFlow} isDisabled={isSaving}>
        <SaveIcon />
        保存
      </Button>
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
                      <PropertyField label="触发表单">
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
                              <span className="px-3 py-2 text-sm text-[var(--color-text-primary)]">
                                {row.label}
                              </span>
                              {row.events.map((event) => (
                                <Checkbox
                                  key={event}
                                  isSelected={flowState.triggerEvents.includes(
                                    event,
                                  )}
                                  onChange={(selected) =>
                                    handleTriggerEventSelection(
                                      row.events,
                                      event,
                                      selected,
                                    )
                                  }
                                  className="px-3 py-2"
                                >
                                  <Checkbox.Content className="sr-only">
                                    <Checkbox.Control>
                                      <Checkbox.Indicator />
                                    </Checkbox.Control>
                                    {event}
                                  </Checkbox.Content>
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
                    <textarea
                      className="min-h-[64px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
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
          isOpen={isNameModalOpen}
          name={nameDraft}
          description={descriptionDraft}
          error={nameError}
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
      className="min-w-0 flex-1 w-40"
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
      <Label>{zoomPercent}%</Label>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  );
}
