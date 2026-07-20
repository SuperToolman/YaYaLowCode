"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect,
  type OnConnectEnd,
} from "@xyflow/react";
import { Button, Dropdown, Input, ListBox, Select, toast } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { Modal } from "@heroui/react/modal";
import {
  getAutomationFlow,
  getFormSchema,
  listAutomationFlowVersions,
  listForms,
  updateAutomationFlow,
  type AutomationFlowVersionSummary,
  type FormSummary,
} from "../../../../lib/api-client";
import {
  AddIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  FormIcon,
  TrashIcon,
} from "../../../../components/app-icons";
import {
  triggerEvents,
  type AutomationStatus,
  type TriggerEvent,
} from "../automation-shared";

type AutomationEditorPageClientProps = {
  appId: string;
  automationId: string;
};

type WorkflowNodeKind =
  | "trigger"
  | "condition"
  | "add-data"
  | "update-data"
  | "get-one"
  | "get-many"
  | "delete-data"
  | "http-request";

type FieldValueType = "value" | "field" | "formula";
type DataSourceMode = "form" | "data-node" | "related-form";
type AddTargetMode = "form" | "subtable";
type AddRecordMode = "single" | "multiple";

type FieldOption = {
  label: string;
  value: string;
};

type SourceFieldChoice = {
  key: string;
  label: string;
  fieldType: string;
  options: FieldOption[];
};

type FormFieldDescriptor = {
  id: string;
  label: string;
  type: string;
  isRequired: boolean;
  options: FieldOption[];
};

type FormSchemaDescriptor = {
  formUuid: string;
  formName: string;
  fields: FormFieldDescriptor[];
};

type TriggerConfig = {
  changedFieldsText?: string;
};

type ConditionBranch = {
  id: string;
  name: string;
  mode: "all" | "rules" | "expression";
  priority: number;
  rules: BranchRule[];
  expression: string;
  hitLabel: string;
};

type ConditionConfig = {
  branches?: ConditionBranch[];
};

type BranchRule = {
  id: string;
  parentId?: string;
  fieldKey?: string;
  operator?: BranchRuleOperator;
  rawValue?: string;
  valueType?: "value" | "field";
  sourceFieldKey?: string;
};

type BranchRuleOperator =
  | "eq"
  | "neq"
  | "inAny"
  | "notInAny"
  | "hasValue"
  | "noValue";

type GetDataConfig = {
  sourceMode?: DataSourceMode;
  formUuid?: string;
  dataNodeId?: string;
  relatedFormPlaceholder?: string;
  filterExpression?: string;
  fieldSelection?: string;
};

type FieldMappingRow = {
  id: string;
  fieldId: string;
  valueType: FieldValueType;
  rawValue?: string;
  sourceFieldKey?: string;
  formula?: string;
};

type AddDataConfig = {
  targetMode?: AddTargetMode;
  targetFormUuid?: string;
  recordMode?: AddRecordMode;
  rows?: FieldMappingRow[];
  multipleSourceMode?: "form" | "data-node";
  multipleSourceNodeId?: string;
  multipleFormula?: string;
};

type ActionConfig = {
  targetFormUuid?: string;
  matchRule?: string;
  rows?: FieldMappingRow[];
  bodyTemplate?: string;
  method?: string;
  url?: string;
  headersText?: string;
};

type WorkflowNodeConfig =
  | TriggerConfig
  | ConditionConfig
  | GetDataConfig
  | AddDataConfig
  | ActionConfig;

type WorkflowNodeData = {
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  config: WorkflowNodeConfig;
};

type WorkflowNode = Node<WorkflowNodeData>;
type PaletteNodeKind = Exclude<WorkflowNodeKind, "trigger">;
type NodeMenuItem = {
  kind: PaletteNodeKind;
  label: string;
  description: string;
};
type WorkflowEdgeData = {
  onInsert?: (sourceId: string, targetId: string, edgeId: string) => void;
};
type WorkflowEdge = Edge<WorkflowEdgeData>;

type FlowState = {
  name: string;
  description: string;
  status: AutomationStatus;
  currentVersion?: number;
  triggerFormUuid: string;
  triggerEvent: TriggerEvent;
  triggerConfig: TriggerConfig;
  createdAt?: string;
  updatedAt?: string;
};

type InsertContext = {
  sourceId: string;
  sourceHandle?: string | null;
  targetId?: string;
  edgeId?: string;
  position?: { x: number; y: number };
};

const edgeTypes = {
  insertable: memo(InsertableEdge),
};

const nodeTypes = {
  workflow: memo(WorkflowCardNode),
};

type WorkflowNodeActions = {
  addConditionBranch: (nodeId: string) => void;
  removeConditionBranch: (nodeId: string, branchId: string) => void;
};

const WorkflowNodeActionsContext = createContext<WorkflowNodeActions>({
  addConditionBranch: () => undefined,
  removeConditionBranch: () => undefined,
});

const dataNodeMenu: Array<{ group: string; items: NodeMenuItem[] }> = [
  {
    group: "数据节点",
    items: [
      { kind: "add-data" as const, label: "新增数据", description: "写入目标表单的新数据" },
      { kind: "update-data" as const, label: "更新数据", description: "更新目标表单已有数据" },
      { kind: "get-one" as const, label: "获取单条数据", description: "按条件查询一条记录" },
      { kind: "get-many" as const, label: "获取多条数据", description: "按条件查询多条记录" },
      { kind: "delete-data" as const, label: "删除数据", description: "按条件删除目标表单记录" },
    ],
  },
  {
    group: "连接器",
    items: [{ kind: "http-request" as const, label: "连接器", description: "调用外部接口或 Webhook" }],
  },
  {
    group: "分支节点",
    items: [{ kind: "condition" as const, label: "条件分支", description: "根据表达式判断后续流转" }],
  },
];

const placeholderNodeGroups = [
  {
    group: "消息节点",
    items: ["消息通知", "发送邮件"],
  },
  {
    group: "人工节点",
    items: ["发起审批"],
  },
];

const branchOperators: Array<{ id: BranchRuleOperator; label: string }> = [
  { id: "eq", label: "等于" },
  { id: "neq", label: "不等于" },
  { id: "inAny", label: "等于任意一个" },
  { id: "notInAny", label: "不等于任意一个" },
  { id: "hasValue", label: "有值" },
  { id: "noValue", label: "无值" },
];

const nodeTone: Record<WorkflowNodeKind, string> = {
  trigger: "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  condition: "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  "add-data": "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success)]",
  "update-data": "border-[var(--color-info)] bg-[var(--color-info-soft)] text-[var(--color-info)]",
  "get-one": "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "get-many": "border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
  "delete-data": "border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  "http-request": "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
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
  const propertyPanelRef = useRef<HTMLElement | null>(null);
  const headerDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [flowState, setFlowState] = useState<FlowState>({
    name: "",
    description: "",
    status: "draft",
    currentVersion: 1,
    triggerFormUuid: "",
    triggerEvent: "after_create",
    triggerConfig: {},
  });
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [formSchemas, setFormSchemas] = useState<Record<string, FormSchemaDescriptor>>({});
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [insertContext, setInsertContext] = useState<InsertContext | null>(null);
  const [isHeaderEditing, setIsHeaderEditing] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [versionItems, setVersionItems] = useState<AutomationFlowVersionSummary[]>([]);
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
      query: { scope: "published" },
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
        name: detail.name,
        description: detail.description ?? "",
        status: detail.status,
        currentVersion: detail.currentVersion,
        triggerFormUuid: detail.triggerFormUuid ?? "",
        triggerEvent: detail.triggerEvent,
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
      setNodes(nextNodes);
      setEdges(
        decorateEdges(
          migrateConditionEdgeHandles(normalizeWorkflowEdges(detail.edges), nextNodes),
          handleInsertRequest,
        ),
      );
      setSelectedNodeId(nextNodes[0]?.id ?? null);

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
      position: {
        x: clientPoint.clientX,
        y: clientPoint.clientY,
      },
    });
  };

  function handleFlowFieldChange<K extends keyof FlowState>(key: K, value: FlowState[K]) {
    setFlowState((current) => {
      const nextState = { ...current, [key]: value };
      if (key === "triggerEvent" && !isUpdateTriggerEvent(String(value) as TriggerEvent)) {
        nextState.triggerConfig = {
          ...nextState.triggerConfig,
          changedFieldsText: "",
        };
      }
      if (key === "triggerFormUuid") {
        nextState.triggerConfig = {
          ...nextState.triggerConfig,
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

  function handleTriggerConfigChange(key: keyof TriggerConfig, value: string) {
    setFlowState((current) => {
      const nextState = {
        ...current,
        triggerConfig: {
          ...current.triggerConfig,
          [key]: value,
        },
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
      const response = await fetch(`/api/automations/${automationId}/versions/${version}/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          change_log: `restored from v${version}`,
        }),
      });
      const payload = await response.json();

      if (!response.ok || payload?.code !== 0 || !payload?.data) {
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

    updateSelectedNodeConfig((config) => ({
      ...config,
      [key]: value,
    }));
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

  function handleAddConditionRule(branchId: string, parentId?: string, siblingOfId?: string) {
    updateSelectedConditionBranch(branchId, (branch) => {
      const nextRule = createBranchRule(parentId);
      const rules = [...branch.rules];

      if (!siblingOfId) {
        return { ...branch, rules: [...rules, nextRule] };
      }

      const index = rules.findIndex((item) => item.id === siblingOfId);
      if (index === -1) {
        return { ...branch, rules: [...rules, nextRule] };
      }

      rules.splice(index + 1, 0, nextRule);
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
      const rules = branch.rules.map((rule) => {
        if (rule.id !== ruleId) {
          return rule;
        }

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
        ? {
            x: (source.position.x + target.position.x) / 2,
            y: (source.position.y + target.position.y) / 2,
          }
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
    setSelectedNodeId(nextNode.id);
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
    setSelectedNodeId("trigger-1");
  }

  function handleSaveFlow() {
    setErrorMessage("");

    startTransition(async () => {
      try {
        const synchronizedNodes = syncTriggerNode(nodes, flowState, forms);
        const payload = serializeWorkflow(synchronizedNodes, edges);
        const { data, error } = await updateAutomationFlow({
          path: { automationId },
          body: {
            name:
              flowState.name.trim() ||
              buildAutomationName(forms, flowState.triggerFormUuid, flowState.triggerEvent),
            description: flowState.description.trim() || undefined,
            status: flowState.status,
            triggerFormUuid: flowState.triggerFormUuid || undefined,
            triggerEvent: flowState.triggerEvent,
            triggerConfig: flowState.triggerConfig,
            nodes: payload.nodes,
            edges: payload.edges,
          },
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
                  className="space-y-3"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Input
                    aria-label="工作流名称"
                    placeholder="工作流名称"
                    value={flowState.name}
                    onChange={(event) =>
                      handleFlowFieldChange("name", event.currentTarget.value)
                    }
                  />
                  <textarea
                    ref={headerDescriptionRef}
                    className="min-h-[88px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
                    placeholder="工作流说明"
                    value={flowState.description}
                    onChange={(event) =>
                      handleFlowFieldChange("description", event.currentTarget.value)
                    }
                  />
                  <div className="flex justify-end">
                    <Button
                      className="h-9 rounded-md bg-[var(--color-primary)] px-4 text-[var(--color-text-on-primary)]"
                      onClick={handleHeaderEditFinish}
                    >
                      完成
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">
                    {flowState.name || "未命名工作流"}
                  </h1>
                  <p className="truncate text-xs text-[var(--color-text-secondary)]">
                    {flowState.description || "双击编辑工作流名称和说明"}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] p-1"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button
                variant="ghost"
                className={[
                  "h-9 rounded-md px-4 text-sm",
                  displayStatus === "enabled"
                    ? "bg-[var(--color-primary)] text-[var(--color-text-on-primary)]"
                    : "bg-transparent text-[var(--color-text-secondary)]",
                ].join(" ")}
                onClick={() => handleStatusToggle("enabled")}
              >
                启动
              </Button>
              <Button
                variant="ghost"
                className={[
                  "h-9 rounded-md px-4 text-sm",
                  displayStatus === "paused"
                    ? "bg-[var(--color-control-selected)] text-[var(--color-text-primary)]"
                    : "bg-transparent text-[var(--color-text-secondary)]",
                ].join(" ")}
                onClick={() => handleStatusToggle("paused")}
              >
                关闭
              </Button>
            </div>
            <Button
              variant="ghost"
              className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 text-[var(--color-text-primary)]"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void openVersionModal()}
            >
              版本管理
            </Button>
            <Button
              variant="ghost"
              className="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 text-[var(--color-text-primary)]"
              onClick={() => router.push(`/${appId}/automations`)}
            >
              返回
            </Button>
            <Button
              className="h-10 rounded-lg bg-[var(--color-primary)] px-4 text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)]"
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
            <ReactFlow<WorkflowNode, WorkflowEdge>
              fitView
              nodes={nodes}
              edges={edges}
              edgeTypes={edgeTypes}
              nodeTypes={nodeTypes}
              onConnect={onConnect}
              onConnectEnd={handleConnectEnd}
              onEdgesChange={onEdgesChange}
              onNodesChange={onNodesChange}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              defaultEdgeOptions={{
                type: "insertable",
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                },
                style: {
                  stroke: "var(--color-primary)",
                  strokeWidth: 1.4,
                },
              }}
              proOptions={{ hideAttribution: true }}
              className="h-full w-full"
            >
              <MiniMap
                pannable
                zoomable
                position="bottom-left"
                nodeBorderRadius={8}
                maskColor="var(--color-flow-mask)"
              />
              <Background gap={18} size={1} color="var(--color-flow-grid)" />
            </ReactFlow>
          </WorkflowNodeActionsContext.Provider>
          {selectedNode ? (
            <aside
              ref={propertyPanelRef}
              className="absolute inset-y-5 right-5 z-20 flex w-full max-w-[500px] flex-col overflow-hidden rounded-[22px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-dialog)] backdrop-blur"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {selectedNode.data.label}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                      {nodeKindLabel(selectedNode.data.kind)}节点参数
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedNode.data.kind !== "trigger" ? (
                      <IconActionButton
                        ariaLabel="删除节点"
                        danger
                        onClick={handleDeleteSelectedNode}
                      >
                        <TrashIcon />
                      </IconActionButton>
                    ) : null}
                    <Button
                      variant="ghost"
                      aria-label="关闭属性配置"
                      className="h-8 min-w-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-[var(--color-text-secondary)]"
                      onClick={() => setSelectedNodeId(null)}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              </div>

              <div className="max-h-[calc(100vh-210px)] space-y-4 overflow-y-auto px-5 py-5">
                {selectedNode.data.kind === "trigger" ? (
                  <PropertyPanelSection title="触发配置" description="工作流名称和说明在左上角双击编辑。">
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
                    <PropertyField label="触发事件">
                      <Select
                        aria-label="触发事件"
                        selectedKey={flowState.triggerEvent}
                        onSelectionChange={(key) =>
                          handleFlowFieldChange(
                            "triggerEvent",
                            String(key ?? "after_create") as TriggerEvent,
                          )
                        }
                      >
                        <Select.Trigger>
                          <Select.Value>
                            {triggerEvents.find((item) => item.id === flowState.triggerEvent)
                              ?.label ?? "创建成功后"}
                          </Select.Value>
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {triggerEvents.map((item) => (
                              <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </PropertyField>
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
                        className="min-h-[82px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
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
                  multipleSourceFieldChoices={multipleSourceFieldChoices}
                  node={selectedNode}
                  selectedSchema={selectedNodeSchema}
                  sourceFieldChoices={sourceFieldChoices}
                  triggerEvent={flowState.triggerEvent}
                  triggerFieldOptions={triggerFieldOptions}
                  onActionTargetFormChange={handleActionTargetFormChange}
                  onAddDataConfigChange={handleAddDataConfigChange}
                  onAddMappingRow={handleAddMappingRow}
                  onBasicChange={handleBasicNodeConfigChange}
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
              </div>
            </aside>
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
                    当前状态：{displayStatus === "enabled" ? "启动" : "关闭"}
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

function WorkflowCardNode({ id, data, selected }: NodeProps<WorkflowNode>) {
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

function InsertableEdge({
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

function IconActionButton({
  ariaLabel,
  children,
  danger = false,
  isDisabled = false,
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  danger?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      variant="ghost"
      isDisabled={isDisabled}
      className={[
        "h-7 min-h-7 w-7 min-w-7 rounded-md border p-0 disabled:opacity-35",
        danger
          ? "border-transparent text-[var(--color-danger)] hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
          : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function PropertyPanelSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{description}</div>
        ) : null}
      </div>
      <div className="space-y-3 px-4 py-4">{children}</div>
    </section>
  );
}

function PropertyField({
  alignStart,
  children,
  label,
}: {
  alignStart?: boolean;
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      className={[
        "grid gap-3 md:grid-cols-[108px_minmax(0,1fr)]",
        alignStart ? "md:items-start" : "md:items-center",
      ].join(" ")}
    >
      <div className="text-sm font-medium text-[var(--color-text-primary)] md:pt-0.5">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function NodeConfigFields({
  forms,
  getManySourceOptions,
  multipleSourceFieldChoices,
  node,
  selectedSchema,
  sourceFieldChoices,
  triggerEvent,
  triggerFieldOptions,
  onActionTargetFormChange,
  onAddDataConfigChange,
  onAddMappingRow,
  onBasicChange,
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
  forms: FormSummary[];
  getManySourceOptions: Array<{ id: string; label: string; description: string }>;
  multipleSourceFieldChoices: SourceFieldChoice[];
  node: WorkflowNode;
  selectedSchema?: FormSchemaDescriptor;
  sourceFieldChoices: SourceFieldChoice[];
  triggerEvent: TriggerEvent;
  triggerFieldOptions: FormFieldDescriptor[];
  onActionTargetFormChange: (formUuid: string) => void;
  onAddDataConfigChange: <K extends keyof AddDataConfig>(key: K, value: AddDataConfig[K]) => void;
  onAddMappingRow: () => void;
  onBasicChange: (key: string, value: string) => void;
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
  onAddConditionRule: (branchId: string, parentId?: string, siblingOfId?: string) => void;
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
  const [editingConditionBranchId, setEditingConditionBranchId] = useState<string | null>(null);

  if (node.data.kind === "trigger") {
    const config = normalizeTriggerConfig(node.data.config);
    return (
      isUpdateTriggerEvent(triggerEvent) ? (
        <PropertyPanelSection title="触发字段" description="仅编辑事件支持按单字段触发。">
          <PropertyField label="变化字段">
            <Select
              aria-label="变化字段"
              selectedKey={config.changedFieldsText || "none"}
              onSelectionChange={(key) =>
                onBasicChange("changedFieldsText", String(key === "none" ? "" : key ?? ""))
              }
            >
              <Select.Trigger>
                <Select.Value>
                  {triggerFieldOptions.find((field) => field.id === config.changedFieldsText)?.label ??
                    "选择字段"}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="none" textValue="未配置">
                    未配置
                  </ListBox.Item>
                  {triggerFieldOptions.map((field) => (
                    <ListBox.Item key={field.id} id={field.id} textValue={field.label}>
                      {field.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </PropertyField>
        </PropertyPanelSection>
      ) : null
    );
  }

  if (node.data.kind === "condition") {
    const config = normalizeConditionConfig(node.data.config);
    const branches = config.branches ?? [];
    return (
      <div className="space-y-4">
        {branches.map((branch, index) => (
          <div
            key={branch.id}
            className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)]"
          >
            <div className="flex min-h-11 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-3 py-2">
              <div className="min-w-0 flex-1">
                {editingConditionBranchId === branch.id ? (
                  <input
                    autoFocus
                    aria-label={`条件分支 ${index + 1} 名称`}
                    className="h-8 w-full rounded-md border border-[var(--color-primary)] bg-[var(--color-bg-surface)] px-2 text-sm font-semibold text-[var(--color-text-primary)] outline-none"
                    value={branch.name}
                    onBlur={() => setEditingConditionBranchId(null)}
                    onChange={(event) =>
                      onConditionBranchChange(branch.id, "name", event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") {
                        setEditingConditionBranchId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="max-w-full truncate rounded px-1 py-1 text-left text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-control-soft-hover)]"
                    onClick={() => setEditingConditionBranchId(branch.id)}
                  >
                    {branch.name || `条件分支 ${index + 1}`}
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconActionButton
                  ariaLabel="上移条件分支"
                  isDisabled={index === 0}
                  onClick={() => onMoveConditionBranch(branch.id, "up")}
                >
                  <ArrowUpIcon />
                </IconActionButton>
                <IconActionButton
                  ariaLabel="下移条件分支"
                  isDisabled={index === branches.length - 1}
                  onClick={() => onMoveConditionBranch(branch.id, "down")}
                >
                  <ArrowDownIcon />
                </IconActionButton>
                <IconActionButton
                  ariaLabel="删除条件分支"
                  danger
                  isDisabled={branches.length <= 1}
                  onClick={() => onRemoveConditionBranch(branch.id)}
                >
                  <TrashIcon />
                </IconActionButton>
              </div>
            </div>

            <div className="space-y-3 p-3">
              <PropertyField label="进入方式">
                <Select
                  aria-label={`条件分支 ${index + 1} 进入方式`}
                  selectedKey={branch.mode}
                  onSelectionChange={(key) =>
                    onConditionModeChange(
                      branch.id,
                      String(key ?? "all") as "all" | "rules" | "expression",
                    )
                  }
                >
                  <Select.Trigger>
                    <Select.Value>{branchModeLabel(branch.mode)}</Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="all" textValue="所有数据均可通过">所有数据均可通过</ListBox.Item>
                      <ListBox.Item id="rules" textValue="按条件规则进入">按条件规则进入</ListBox.Item>
                      <ListBox.Item id="expression" textValue="按表达式进入">按表达式进入</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </PropertyField>
              <PropertyField label="命中说明">
                <Input
                  aria-label={`条件分支 ${index + 1} 命中说明`}
                  placeholder={`例如：分支 ${index + 1} 满足审批条件`}
                  value={branch.hitLabel}
                  onChange={(event) =>
                    onConditionBranchChange(branch.id, "hitLabel", event.currentTarget.value)
                  }
                />
              </PropertyField>

              {branch.mode === "all" ? (
                <div className="rounded-lg bg-[var(--color-info-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-info)]">
                当前分支默认放行所有流转到该条件节点的数据。
                </div>
              ) : null}

              {branch.mode === "rules" ? (
                <BranchRulesEditor
                  rules={branch.rules}
                  sourceFieldChoices={sourceFieldChoices}
                  onAddConditionRule={(parentId, siblingOfId) =>
                    onAddConditionRule(branch.id, parentId, siblingOfId)
                  }
                  onConditionRuleChange={(ruleId, key, value) =>
                    onConditionRuleChange(branch.id, ruleId, key, value)
                  }
                  onRemoveConditionRule={(ruleId) =>
                    onRemoveConditionRule(branch.id, ruleId)
                  }
                />
              ) : null}

              {branch.mode === "expression" ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-[var(--color-text-primary)]">表达式</div>
                <TextAreaInput
                  ariaLabel={`条件分支 ${index + 1} 表达式`}
                  placeholder="输入表达式，例如 前置节点.状态 == '已完成'"
                  value={branch.expression}
                  onChange={(value) =>
                    onConditionBranchChange(branch.id, "expression", value)
                  }
                />
                </div>
              ) : null}
            </div>
          </div>
        ))}

        <Button
          variant="ghost"
          className="h-10 w-full rounded-lg border border-dashed border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
          onClick={onAddConditionBranch}
        >
          <AddIcon />
          添加分支
        </Button>
      </div>
    );
  }

  if (node.data.kind === "get-one" || node.data.kind === "get-many") {
    const config = normalizeGetDataConfig(node.data.config);
    const sourceNodeOptions = sourceFieldChoices
      .filter((item) => item.key.includes(":"))
      .map((item) => item.key.split(":")[0])
      .filter((value, index, array) => array.indexOf(value) === index);
    return (
      <PropertyPanelSection title="数据来源配置">
        <Select
          aria-label="数据来源"
          selectedKey={config.sourceMode ?? "form"}
          onSelectionChange={(key) =>
            onGetNodeSourceModeChange(String(key ?? "form") as DataSourceMode)
          }
        >
          <Select.Trigger>
            <Select.Value>{getSourceModeLabel(config.sourceMode ?? "form")}</Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="form" textValue="从表单获取">
                从表单获取
              </ListBox.Item>
              <ListBox.Item id="data-node" textValue="从数据节点获取">
                从数据节点获取
              </ListBox.Item>
              <ListBox.Item id="related-form" textValue="从关联表单获取">
                从关联表单获取
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        {config.sourceMode === "form" ? (
          <FormSelect
            forms={forms}
            value={config.formUuid ?? ""}
            placeholder="选择来源表单"
            onChange={onGetNodeFormChange}
          />
        ) : null}
        {config.sourceMode === "data-node" ? (
          <Select
            aria-label="数据节点"
            selectedKey={config.dataNodeId || "none"}
            onSelectionChange={(key) =>
              onGetNodeSourceNodeChange(String(key === "none" ? "" : key ?? ""))
            }
          >
            <Select.Trigger>
              <Select.Value>{config.dataNodeId || "选择数据节点"}</Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="none" textValue="未配置">
                  未配置
                </ListBox.Item>
                {sourceNodeOptions.map((nodeId) => (
                  <ListBox.Item key={nodeId} id={nodeId} textValue={nodeId}>
                    {nodeId}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : null}
        {config.sourceMode === "related-form" ? (
          <Input
            aria-label="关联表单占位"
            placeholder="关联表单组件暂未开发，先预留配置"
            value={config.relatedFormPlaceholder ?? ""}
            onChange={(event) =>
              onBasicChange("relatedFormPlaceholder", event.currentTarget.value)
            }
          />
        ) : null}
        <ExpressionEditor
          ariaLabel="筛选条件"
          helperText="筛选条件支持插入上游字段引用。"
          options={sourceFieldChoices}
          placeholder="筛选条件，例如 {{trigger:code}} == code"
          value={config.filterExpression ?? ""}
          onChange={(value) => onBasicChange("filterExpression", value)}
        />
        <Input
          aria-label="返回字段"
          placeholder="返回字段，例如 code,name,status"
          value={config.fieldSelection ?? ""}
          onChange={(event) => onBasicChange("fieldSelection", event.currentTarget.value)}
        />
      </PropertyPanelSection>
    );
  }

  if (node.data.kind === "add-data") {
    const config = normalizeAddDataConfig(node.data.config);
    const rows = config.rows ?? [];
    const targetFields = selectedSchema?.fields ?? [];
    const activeSourceFields =
      config.recordMode === "multiple" ? multipleSourceFieldChoices : sourceFieldChoices;
    return (
      <div className="space-y-4">
        <PropertyPanelSection title="新增方式">
          <PropertyField label="新增位置">
            <Select
              aria-label="新增位置"
              selectedKey={config.targetMode ?? "form"}
              onSelectionChange={(key) =>
                onAddDataConfigChange(
                  "targetMode",
                  String(key ?? "form") as AddTargetMode,
                )
              }
            >
              <Select.Trigger>
                <Select.Value>
                  {config.targetMode === "subtable" ? "在子表中新增" : "在表单中新增"}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="form" textValue="在表单中新增">
                    在表单中新增
                  </ListBox.Item>
                  <ListBox.Item id="subtable" textValue="在子表中新增">
                    在子表中新增
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </PropertyField>
          <PropertyField label="目标表单">
            <FormSelect
              forms={forms}
              value={config.targetFormUuid ?? ""}
              placeholder="选择目标表单"
              onChange={onActionTargetFormChange}
            />
          </PropertyField>
          <PropertyField label="新增数据">
            <Select
              aria-label="新增数据方式"
              selectedKey={config.recordMode ?? "single"}
              onSelectionChange={(key) =>
                onAddDataConfigChange("recordMode", String(key ?? "single") as AddRecordMode)
              }
            >
              <Select.Trigger>
                <Select.Value>
                  {config.recordMode === "multiple" ? "新增多条数据" : "新增单条数据"}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="single" textValue="新增单条数据">
                    新增单条数据
                  </ListBox.Item>
                  <ListBox.Item id="multiple" textValue="新增多条数据">
                    新增多条数据
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </PropertyField>
          {config.recordMode === "multiple" ? (
            <PropertyField label="数据来源">
              <Select
                aria-label="多条数据来源"
                selectedKey={config.multipleSourceNodeId || "none"}
                onSelectionChange={(key) =>
                  onAddDataConfigChange(
                    "multipleSourceNodeId",
                    String(key === "none" ? "" : key ?? ""),
                  )
                }
              >
                <Select.Trigger>
                  <Select.Value>
                    {getManySourceOptions.find((item) => item.id === config.multipleSourceNodeId)
                      ?.label ?? "选择获取多条数据节点"}
                  </Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="none" textValue="未配置">
                      未配置
                    </ListBox.Item>
                    {getManySourceOptions.map((item) => (
                      <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                        <div className="text-sm text-[var(--color-text-primary)]">{item.label}</div>
                        <div className="text-xs text-[var(--color-text-secondary)]">{item.description}</div>
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              {getManySourceOptions.length === 0 ? (
                <div className="mt-2 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-warning)]">
                  请先在当前节点前添加“获取多条数据”节点，再作为多条新增的数据源。
                </div>
              ) : null}
            </PropertyField>
          ) : null}
        </PropertyPanelSection>

        <MappingRowsEditor
          rows={rows}
          sourceFieldChoices={activeSourceFields}
          targetFields={targetFields}
          onAddMappingRow={onAddMappingRow}
          onRemoveMappingRow={onRemoveMappingRow}
          onRowChange={onRowChange}
        />
      </div>
    );
  }

  if (
    node.data.kind === "update-data" ||
    node.data.kind === "delete-data"
  ) {
    const config = normalizeActionConfig(node.data.config);
    const targetFields = selectedSchema?.fields ?? [];
    return (
      <div className="space-y-4">
        <PropertyPanelSection title={node.data.kind === "update-data" ? "更新配置" : "删除配置"}>
          <FormSelect
            forms={forms}
            value={config.targetFormUuid ?? ""}
            placeholder="选择目标表单"
            onChange={onActionTargetFormChange}
          />
          <ExpressionEditor
            ariaLabel="匹配条件"
            helperText="匹配条件支持引用触发记录和查询节点字段。"
            options={sourceFieldChoices}
            placeholder="匹配条件，例如 {{get-one-1:id}} == id"
            value={config.matchRule ?? ""}
            onChange={(value) => onBasicChange("matchRule", value)}
          />
          {node.data.kind === "update-data" ? (
            <TextAreaInput
              ariaLabel="更新说明"
              placeholder="更新说明，可选"
              value={config.bodyTemplate ?? ""}
              onChange={(value) => onBasicChange("bodyTemplate", value)}
            />
          ) : null}
        </PropertyPanelSection>
        {node.data.kind === "update-data" ? (
          <MappingRowsEditor
            lockRequiredRows={false}
            rows={config.rows ?? []}
            sourceFieldChoices={sourceFieldChoices}
            targetFields={targetFields}
            onAddMappingRow={onAddMappingRow}
            onRemoveMappingRow={onRemoveMappingRow}
            onRowChange={onRowChange}
          />
        ) : null}
      </div>
    );
  }

  if (node.data.kind === "http-request") {
    const config = normalizeActionConfig(node.data.config);
    return (
      <PropertyPanelSection title="连接器配置">
        <Input
          aria-label="请求方法"
          placeholder="POST / GET / PUT"
          value={config.method ?? ""}
          onChange={(event) => onBasicChange("method", event.currentTarget.value)}
        />
        <Input
          aria-label="请求地址"
          placeholder="https://example.com/webhook"
          value={config.url ?? ""}
          onChange={(event) => onBasicChange("url", event.currentTarget.value)}
        />
        <TextAreaInput
          ariaLabel="请求头"
          placeholder="请求头 JSON"
          value={config.headersText ?? ""}
          onChange={(value) => onBasicChange("headersText", value)}
        />
        <TextAreaInput
          ariaLabel="请求体"
          placeholder="请求体模板"
          value={config.bodyTemplate ?? ""}
          onChange={(value) => onBasicChange("bodyTemplate", value)}
        />
      </PropertyPanelSection>
    );
  }

  return null;
}

function MappingRowsEditor({
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
  sourceFieldChoices: Array<{ key: string; label: string; fieldType: string }>;
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
          <div className="hidden grid-cols-[1.1fr_0.7fr_minmax(0,1.3fr)_72px] gap-3 px-2 text-xs font-medium text-[var(--color-text-secondary)] md:grid">
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
                className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3 md:grid-cols-[1.1fr_0.7fr_minmax(0,1.3fr)_72px] md:items-start"
              >
                <FieldSelect
                  fields={targetFields}
                  value={row.fieldId}
                  onChange={(value) => onRowChange(row.id, "fieldId", value)}
                />
                <Select
                  aria-label="字段值类型"
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
                <div className="min-w-0">
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

function BranchRulesEditor({
  rules,
  sourceFieldChoices,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  onAddConditionRule: (parentId?: string, siblingOfId?: string) => void;
  onConditionRuleChange: (ruleId: string, key: keyof BranchRule, value: string) => void;
  onRemoveConditionRule: (ruleId: string) => void;
}) {
  const rootRules = rules.filter((rule) => !rule.parentId);

  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text-primary)]">条件规则</div>
          <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">支持同级条件和子条件。</div>
        </div>
        <IconActionButton ariaLabel="添加条件" onClick={() => onAddConditionRule()}>
          <AddIcon />
        </IconActionButton>
      </div>
      <div className="space-y-2 overflow-x-auto pb-1">
        {rootRules.length > 0 ? (
          rootRules.map((rule) => (
            <BranchRuleItem
              key={rule.id}
              rule={rule}
              rules={rules}
              sourceFieldChoices={sourceFieldChoices}
              depth={0}
              onAddConditionRule={onAddConditionRule}
              onConditionRuleChange={onConditionRuleChange}
              onRemoveConditionRule={onRemoveConditionRule}
            />
          ))
        ) : (
          <button
            type="button"
            className="w-full rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            onClick={() => onAddConditionRule()}
          >
            添加第一条条件
          </button>
        )}
      </div>
    </div>
  );
}

function BranchRuleItem({
  depth,
  rule,
  rules,
  sourceFieldChoices,
  onAddConditionRule,
  onConditionRuleChange,
  onRemoveConditionRule,
}: {
  depth: number;
  rule: BranchRule;
  rules: BranchRule[];
  sourceFieldChoices: SourceFieldChoice[];
  onAddConditionRule: (parentId?: string, siblingOfId?: string) => void;
  onConditionRuleChange: (ruleId: string, key: keyof BranchRule, value: string) => void;
  onRemoveConditionRule: (ruleId: string) => void;
}) {
  const selectedField = sourceFieldChoices.find((item) => item.key === rule.fieldKey);
  const childRules = rules.filter((item) => item.parentId === rule.id);
  const operator = rule.operator ?? "eq";
  const hideValue = operator === "hasValue" || operator === "noValue";
  const valueType = rule.valueType ?? "value";

  return (
    <div className="space-y-2">
      <div
        className="relative min-w-[620px]"
        style={{ marginLeft: `${Math.min(depth, 4) * 18}px` }}
      >
        {depth > 0 ? (
          <span className="absolute -left-3 top-1/2 h-px w-3 bg-[var(--color-border)]" />
        ) : null}
        <div className="grid grid-cols-[minmax(130px,1.2fr)_92px_86px_minmax(130px,1fr)_28px_28px] items-center gap-2">
            <SourceFieldSelect
              options={sourceFieldChoices}
              value={rule.fieldKey ?? ""}
              onChange={(value) => onConditionRuleChange(rule.id, "fieldKey", value)}
            />
            <Select
              aria-label="条件运算符"
              selectedKey={operator}
              onSelectionChange={(key) =>
                onConditionRuleChange(
                  rule.id,
                  "operator",
                  String(key ?? "eq"),
                )
              }
            >
              <Select.Trigger>
                <Select.Value>{branchOperatorLabel(operator)}</Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {branchOperators.map((item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            {hideValue ? (
              <>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">无需值</div>
                <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-xs text-[var(--color-text-secondary)]">—</div>
              </>
            ) : (
              <>
                <Select
                  aria-label="条件值类型"
                  selectedKey={valueType}
                  onSelectionChange={(key) =>
                    onConditionRuleChange(rule.id, "valueType", String(key ?? "value"))
                  }
                >
                  <Select.Trigger>
                    <Select.Value>{valueType === "field" ? "字段" : "值"}</Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="value" textValue="值">值</ListBox.Item>
                      <ListBox.Item id="field" textValue="字段">字段</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                {valueType === "field" ? (
                  <SourceFieldSelect
                    options={sourceFieldChoices}
                    value={rule.sourceFieldKey ?? ""}
                    onChange={(value) =>
                      onConditionRuleChange(rule.id, "sourceFieldKey", value)
                    }
                  />
                ) : (
                  <BranchRuleValueInput
                    field={selectedField}
                    operator={operator}
                    value={rule.rawValue ?? ""}
                    onChange={(value) => onConditionRuleChange(rule.id, "rawValue", value)}
                  />
                )}
              </>
            )}
            <IconActionButton
              ariaLabel="删除条件规则"
              danger
              onClick={() => onRemoveConditionRule(rule.id)}
            >
              <TrashIcon />
            </IconActionButton>
            <Dropdown>
              <Dropdown.Trigger
                aria-label="添加条件规则"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-primary)]"
              >
                <AddIcon />
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="添加条件规则方式"
                  onAction={(key) => {
                    if (key === "child") {
                      onAddConditionRule(rule.id);
                    } else {
                      onAddConditionRule(undefined, rule.id);
                    }
                  }}
                >
                  <Dropdown.Item id="sibling">同层级条件</Dropdown.Item>
                  <Dropdown.Item id="child">子级条件</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
        </div>
      </div>

      {childRules.length > 0 ? (
        <div className="space-y-2 border-l border-[var(--color-border)] pl-1">
          {childRules.map((child) => (
            <BranchRuleItem
              key={child.id}
              depth={depth + 1}
              rule={child}
              rules={rules}
              sourceFieldChoices={sourceFieldChoices}
              onAddConditionRule={onAddConditionRule}
              onConditionRuleChange={onConditionRuleChange}
              onRemoveConditionRule={onRemoveConditionRule}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BranchRuleValueInput({
  field,
  operator,
  value,
  onChange,
}: {
  field?: SourceFieldChoice;
  operator: BranchRuleOperator;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field?.options.length && (field.fieldType === "select" || field.fieldType === "radio")) {
    if (operator === "inAny" || operator === "notInAny") {
      return (
        <Input
          aria-label="匹配值"
          placeholder="多个选项值用逗号分隔"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    }

    return (
      <Select
        aria-label="匹配值"
        selectedKey={value || "none"}
        onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
      >
        <Select.Trigger>
          <Select.Value>
            {field.options.find((option) => option.value === value)?.label ?? "选择匹配值"}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="none" textValue="未配置">
              未配置
            </ListBox.Item>
            {field.options.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  if (field?.fieldType === "multiLineText" || field?.fieldType === "description") {
    return (
      <textarea
        className="min-h-[84px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
        placeholder={operator === "inAny" || operator === "notInAny" ? "多个值用逗号分隔" : "输入匹配值"}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <Input
      aria-label="匹配值"
      placeholder={operator === "inAny" || operator === "notInAny" ? "多个值用逗号分隔" : "输入匹配值"}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function MappingFormulaInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      aria-label="公式值"
      className="min-h-[88px] w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10"
      placeholder="请输入公式，例如 @SUM($amount, 100)"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function TextAreaInput({
  ariaLabel,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      className="min-h-[88px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function ExpressionEditor({
  ariaLabel,
  helperText,
  options,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  helperText?: string;
  options: Array<{ key: string; label: string; fieldType: string }>;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const tokenMatches = extractExpressionTokens(value);
  const optionMap = new Map(options.map((option) => [option.key, option]));
  const resolvedTokens = tokenMatches
    .map((token) => ({
      token,
      option: optionMap.get(token),
    }))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.token === item.token) === index);
  const invalidTokens = resolvedTokens.filter((item) => !item.option);
  const validTokens = resolvedTokens.filter((item): item is { token: string; option: { key: string; label: string; fieldType: string } } =>
    Boolean(item.option),
  );

  const insertToken = (token: string) => {
    const nextValue = value.trim() ? `${value} ${token}` : token;
    onChange(nextValue);
  };

  return (
    <div className="space-y-3">
      <textarea
        aria-label={ariaLabel}
        className="min-h-[96px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
        placeholder={placeholder}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {helperText ? (
        <div className="text-xs leading-5 text-[var(--color-text-secondary)]">{helperText}</div>
      ) : null}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
        <div className="text-xs font-medium text-[var(--color-text-primary)]">表达式检查</div>
        {value.trim().length === 0 ? (
          <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            直接输入表达式，字段引用格式为 <code>{`{{nodeId:fieldId}}`}</code>。
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {validTokens.length > 0 ? (
              <div>
                <div className="text-xs text-[var(--color-text-secondary)]">已引用字段</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {validTokens.map((item) => (
                    <span
                      key={item.token}
                      className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-2.5 py-1 text-xs text-[var(--color-primary)]"
                    >
                      {item.option.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--color-text-secondary)]">当前表达式未引用字段。</div>
            )}
            {invalidTokens.length > 0 ? (
              <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-danger)]">
                无效字段引用：{invalidTokens.map((item) => `{{${item.token}}}`).join("、")}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {options.length > 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
          <div className="text-xs font-medium text-[var(--color-text-primary)]">插入字段引用</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs text-[var(--color-text-primary)] transition hover:bg-[var(--color-primary-soft)]"
                onClick={() => insertToken(`{{${option.key}}}`)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FormSelect({
  forms,
  value,
  placeholder,
  onChange,
}: {
  forms: FormSummary[];
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label={placeholder}
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {forms.find((form) => form.id === value)?.name ?? placeholder}
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
  );
}

function FieldSelect({
  fields,
  value,
  onChange,
}: {
  fields: FormFieldDescriptor[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="字段名"
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {fields.find((field) => field.id === value)?.label ?? "字段名"}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="none" textValue="未配置">
            未配置
          </ListBox.Item>
          {fields.map((field) => (
            <ListBox.Item key={field.id} id={field.id} textValue={field.label}>
              {field.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function SourceFieldSelect({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="来源字段"
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {options.find((option) => option.key === value)?.label ?? "字段值"}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="none" textValue="未配置">
            未配置
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function FieldValueInput({
  field,
  value,
  onChange,
}: {
  field?: FormFieldDescriptor;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field?.type === "select" || field?.type === "radio") {
    return (
      <Select
        aria-label={field ? `${field.label}字段值` : "字段值"}
        selectedKey={value || "none"}
        onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
      >
        <Select.Trigger>
          <Select.Value>
            {field.options.find((option) => option.value === value)?.label ?? "字段值"}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="none" textValue="未配置">
              未配置
            </ListBox.Item>
            {field.options.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  if (field?.type === "multiSelect" || field?.type === "checkbox") {
    return (
      <Input
        aria-label="字段值"
        placeholder="多个值用逗号分隔"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  if (field?.type === "multiLineText" || field?.type === "description") {
    return (
      <textarea
        className="min-h-[88px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
        placeholder="字段值"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <Input
      aria-label="字段值"
      placeholder={field ? `${field.label} 的值` : "字段值"}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function createWorkflowNode(kind: PaletteNodeKind, index: number): WorkflowNode {
  return {
    id: `${kind}-${Date.now()}-${index}`,
    type: "workflow",
    position: { x: 360 + index * 32, y: 180 + index * 40 },
    data: defaultNodeTemplate(kind),
  };
}

function defaultNodeTemplate(kind: WorkflowNodeKind): WorkflowNodeData {
  switch (kind) {
    case "trigger":
      return {
        kind,
        label: "表单事件触发",
        description: "根据表单记录事件开始执行工作流",
        config: {
          changedFieldsText: "",
        } satisfies TriggerConfig,
      };
    case "condition":
      return {
        kind,
        label: "条件分支",
        description: "按优先级和条件规则控制后续走向",
        config: {
          branches: [createConditionBranch(1)],
        } satisfies ConditionConfig,
      };
    case "add-data":
      return {
        kind,
        label: "新增数据",
        description: "向目标表单新增单条或多条数据",
        config: {
          targetMode: "form",
          targetFormUuid: "",
          recordMode: "single",
          rows: [],
          multipleSourceMode: "data-node",
          multipleSourceNodeId: "",
          multipleFormula: "",
        } satisfies AddDataConfig,
      };
    case "update-data":
      return {
        kind,
        label: "更新数据",
        description: "根据匹配条件更新目标表单记录",
        config: {
          targetFormUuid: "",
          matchRule: "",
          rows: [],
          bodyTemplate: "",
        } satisfies ActionConfig,
      };
    case "get-one":
      return {
        kind,
        label: "获取单条数据",
        description: "从表单、数据节点或关联表单中获取一条数据",
        config: {
          sourceMode: "form",
          formUuid: "",
          dataNodeId: "",
          relatedFormPlaceholder: "",
          filterExpression: "",
          fieldSelection: "",
        } satisfies GetDataConfig,
      };
    case "get-many":
      return {
        kind,
        label: "获取多条数据",
        description: "从表单、数据节点或关联表单中获取多条数据",
        config: {
          sourceMode: "form",
          formUuid: "",
          dataNodeId: "",
          relatedFormPlaceholder: "",
          filterExpression: "",
          fieldSelection: "",
        } satisfies GetDataConfig,
      };
    case "delete-data":
      return {
        kind,
        label: "删除数据",
        description: "按匹配条件删除目标表单数据",
        config: {
          targetFormUuid: "",
          matchRule: "",
        } satisfies ActionConfig,
      };
    case "http-request":
      return {
        kind,
        label: "连接器",
        description: "调用外部 HTTP 接口或 Webhook",
        config: {
          method: "POST",
          url: "",
          headersText: "",
          bodyTemplate: "",
        } satisfies ActionConfig,
      };
  }
}

function createEditorEdge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): WorkflowEdge {
  return {
    id: `edge-${source}-${sourceHandle ?? "default"}-${target}-${Date.now()}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "insertable",
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    style: {
      stroke: "var(--color-primary)",
      strokeWidth: 1.4,
    },
  };
}

function decorateEdges(
  edges: WorkflowEdge[],
  onInsert: (sourceId: string, targetId: string, edgeId: string) => void,
) {
  return edges.map((edge) => {
    if (edge.type === "insertable" && edge.data?.onInsert === onInsert) {
      return edge;
    }
    return {
      ...edge,
      type: "insertable",
      data: {
        ...edge.data,
        onInsert,
      },
    };
  });
}

function normalizeWorkflowNodes(rawNodes: Array<{ [key: string]: unknown }>): WorkflowNode[] {
  return rawNodes.flatMap((item, index) => {
    const rawData = isRecord(item.data) ? item.data : {};
    const kind = normalizeNodeKind(rawData.kind);
    if (!kind) {
      return [];
    }

    const normalizedKind = kind === "create-record"
      ? "add-data"
      : kind === "update-record"
        ? "update-data"
        : kind === "delete-record"
          ? "delete-data"
          : kind;

    const template = defaultNodeTemplate(normalizedKind);
    return [
      {
        id: readStringValue(item.id) || `${normalizedKind}-${index + 1}`,
        type: "workflow",
        position: normalizePosition(item.position, index),
        data: {
          kind: normalizedKind,
          label: readStringValue(rawData.label) || template.label,
          description: readStringValue(rawData.description) || template.description,
          config: normalizeNodeConfigByKind(normalizedKind, rawData.config),
        },
      },
    ];
  });
}

function normalizeWorkflowEdges(rawEdges: Array<{ [key: string]: unknown }>): WorkflowEdge[] {
  return rawEdges.flatMap((item, index) => {
    const source = readStringValue(item.source);
    const target = readStringValue(item.target);
    if (!source || !target) {
      return [];
    }

    return [
      {
        id: readStringValue(item.id) || `edge-${index + 1}`,
        source,
        target,
        sourceHandle: readStringValue(item.sourceHandle) || null,
        targetHandle: readStringValue(item.targetHandle) || null,
        type: "insertable",
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
        style: {
          stroke: "var(--color-primary)",
          strokeWidth: 1.4,
        },
      },
    ];
  });
}

function migrateConditionEdgeHandles(edges: WorkflowEdge[], nodes: WorkflowNode[]) {
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    if (edge.sourceHandle) {
      return edge;
    }
    const sourceNode = nodeLookup.get(edge.source);
    const sourceHandle = sourceNode ? defaultSourceHandleForNode(sourceNode) : null;
    return sourceHandle ? { ...edge, sourceHandle } : edge;
  });
}

function defaultSourceHandleForNode(node: WorkflowNode) {
  if (node.data.kind !== "condition") {
    return null;
  }
  const firstBranch = normalizeConditionConfig(node.data.config).branches?.[0];
  return firstBranch ? conditionBranchHandleId(firstBranch.id) : null;
}

function ensureTriggerNode(
  nodes: WorkflowNode[],
  flowState: FlowState,
  forms: FormSummary[],
) {
  if (nodes.some((node) => node.data.kind === "trigger")) {
    return syncTriggerNode(nodes, flowState, forms);
  }

  return [createTriggerNode(flowState, forms), ...nodes];
}

function createTriggerNode(flowState: FlowState, forms: FormSummary[]): WorkflowNode {
  return {
    id: "trigger-1",
    type: "workflow",
    position: { x: 120, y: 200 },
    data: buildTriggerNodeData(flowState, forms),
  };
}

function syncTriggerNode(nodes: WorkflowNode[], flowState: FlowState, forms: FormSummary[]) {
  return nodes.map((node) =>
    node.data.kind === "trigger"
      ? {
          ...node,
          data: buildTriggerNodeData(flowState, forms),
        }
      : node,
  );
}

function buildTriggerNodeData(flowState: FlowState, forms: FormSummary[]): WorkflowNodeData {
  const formName =
    forms.find((form) => form.id === flowState.triggerFormUuid)?.name ?? "未配置表单";
  const eventLabel =
    triggerEvents.find((item) => item.id === flowState.triggerEvent)?.label ?? "创建成功后";

  return {
    kind: "trigger",
    label: "表单事件触发",
    description: `${formName} / ${eventLabel}`,
    config: {
      changedFieldsText: flowState.triggerConfig.changedFieldsText ?? "",
    },
  };
}

function buildAutomationName(
  forms: FormSummary[],
  formUuid: string,
  triggerEvent: TriggerEvent,
) {
  const formName = forms.find((form) => form.id === formUuid)?.name ?? "表单";
  const eventLabel =
    triggerEvents.find((item) => item.id === triggerEvent)?.label ?? "创建成功后";

  return `${formName}${eventLabel}`;
}

function serializeWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}

function normalizeFormSchema(schema: Record<string, unknown>): FormSchemaDescriptor {
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return {
    formUuid: readStringValue(schema.formUuid),
    formName: readStringValue(schema.formName),
    fields: fields
      .map((item) => normalizeSchemaField(item))
      .filter((item): item is FormFieldDescriptor => item !== null),
  };
}

function normalizeSchemaField(value: unknown): FormFieldDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }

  const props = isRecord(value.props) ? value.props : {};
  const options = Array.isArray(props.options)
    ? props.options
        .map((item) => {
          if (!isRecord(item)) {
            return null;
          }
          const label = readStringValue(item.label);
          const optionValue = readStringValue(item.value);
          if (!label || !optionValue) {
            return null;
          }
          return { label, value: optionValue };
        })
        .filter((item): item is FieldOption => item !== null)
    : [];

  const fieldType = readStringValue(value.type);
  if (!fieldType || fieldType === "groupContainer" || fieldType === "button") {
    return null;
  }

  return {
    id: readStringValue(value.id),
    label: readStringValue(value.label),
    type: fieldType,
    isRequired: props.isRequired === true,
    options,
  };
}

function collectSchemaTargets(flowState: FlowState, nodes: WorkflowNode[]) {
  const targetSet = new Set<string>();
  if (flowState.triggerFormUuid) {
    targetSet.add(flowState.triggerFormUuid);
  }
  for (const node of nodes) {
    if (node.data.kind === "add-data" || node.data.kind === "update-data" || node.data.kind === "delete-data") {
      const formUuid = readStringValue((node.data.config as ActionConfig).targetFormUuid);
      if (formUuid) {
        targetSet.add(formUuid);
      }
    }
    if (node.data.kind === "get-one" || node.data.kind === "get-many") {
      const formUuid = readStringValue((node.data.config as GetDataConfig).formUuid);
      if (formUuid) {
        targetSet.add(formUuid);
      }
    }
  }
  return [...targetSet];
}

function buildSourceFieldChoices({
  currentNodeId,
  edges,
  formSchemas,
  flowState,
  nodes,
}: {
  currentNodeId: string | null;
  edges: WorkflowEdge[];
  formSchemas: Record<string, FormSchemaDescriptor>;
  flowState: FlowState;
  nodes: WorkflowNode[];
}) {
  const upstreamIds = collectUpstreamNodeIds(edges, currentNodeId);
  const orderedNodes = nodes.filter((node) => upstreamIds.has(node.id));
  const choices: SourceFieldChoice[] = [];

  for (const node of orderedNodes) {
    const schema = getSchemaForSourceNode(node, formSchemas, flowState);
    if (!schema) {
      continue;
    }

    const nodeLabel = node.data.label || node.id;
    for (const field of schema.fields) {
      choices.push({
        key: `${node.id}:${field.id}`,
        label: `${nodeLabel}.${field.label}`,
        fieldType: field.type,
        options: field.options,
      });
    }
  }

  return choices;
}

function buildGetManySourceOptions(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  currentNodeId: string | null,
) {
  const upstreamIds = collectUpstreamNodeIds(edges, currentNodeId);
  return nodes
    .filter((node) => upstreamIds.has(node.id) && node.data.kind === "get-many")
    .map((node) => ({
      id: node.id,
      label: node.data.label || node.id,
      description: node.data.description || "获取多条数据",
    }));
}

function collectUpstreamNodeIds(edges: WorkflowEdge[], currentNodeId: string | null) {
  const upstreamIds = new Set<string>();
  if (!currentNodeId) {
    return upstreamIds;
  }

  const pending = [currentNodeId];
  while (pending.length > 0) {
    const targetId = pending.shift();
    if (!targetId) {
      continue;
    }

    for (const edge of edges) {
      if (edge.target !== targetId || upstreamIds.has(edge.source)) {
        continue;
      }
      upstreamIds.add(edge.source);
      pending.push(edge.source);
    }
  }
  return upstreamIds;
}

function buildDataNodeFieldChoices({
  formSchemas,
  nodeId,
  nodes,
}: {
  formSchemas: Record<string, FormSchemaDescriptor>;
  nodeId: string;
  nodes: WorkflowNode[];
}) {
  const sourceNode = nodes.find((node) => node.id === nodeId && node.data.kind === "get-many");
  if (!sourceNode) {
    return [];
  }

  const config = normalizeGetDataConfig(sourceNode.data.config);
  const schema = config.formUuid ? formSchemas[config.formUuid] : undefined;
  if (!schema) {
    return [];
  }

  return schema.fields.map((field) => ({
    key: `${sourceNode.id}:${field.id}`,
    label: `${sourceNode.data.label || sourceNode.id}.${field.label}`,
    fieldType: field.type,
    options: field.options,
  }));
}

function getSchemaForNodeTarget(
  node: WorkflowNode,
  formSchemas: Record<string, FormSchemaDescriptor>,
) {
  const targetFormUuid =
    readStringValue((node.data.config as AddDataConfig | ActionConfig).targetFormUuid);
  return targetFormUuid ? formSchemas[targetFormUuid] : undefined;
}

function getSchemaFields(
  formUuid: string | undefined,
  formSchemas: Record<string, FormSchemaDescriptor>,
) {
  return formUuid ? formSchemas[formUuid]?.fields ?? [] : [];
}

function createFieldMappingRow(fieldId: string): FieldMappingRow {
  return {
    id: `row-${fieldId}-${Date.now()}`,
    fieldId,
    valueType: "value",
    rawValue: "",
    sourceFieldKey: "",
    formula: "",
  };
}

function createBranchRule(parentId?: string): BranchRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    fieldKey: "",
    operator: "eq",
    rawValue: "",
    valueType: "value",
    sourceFieldKey: "",
  };
}

function createConditionBranch(priority: number): ConditionBranch {
  return {
    id: `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `条件分支 ${priority}`,
    mode: "all",
    priority,
    rules: [],
    expression: "",
    hitLabel: "",
  };
}

function conditionBranchHandleId(branchId: string) {
  return `condition-branch:${branchId}`;
}

function syncRequiredRows(rows: FieldMappingRow[], fields: FormFieldDescriptor[]) {
  const nextRows = [...rows];
  for (const field of fields.filter((item) => item.isRequired)) {
    if (!nextRows.some((row) => row.fieldId === field.id)) {
      nextRows.push(createFieldMappingRow(field.id));
    }
  }
  return nextRows;
}

function normalizePosition(value: unknown, index: number) {
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y };
  }

  return { x: 340 + index * 30, y: 200 + index * 36 };
}

function normalizeNodeKind(value: unknown): WorkflowNodeKind | "create-record" | "update-record" | "delete-record" | null {
  if (
    value === "trigger" ||
    value === "condition" ||
    value === "add-data" ||
    value === "update-data" ||
    value === "get-one" ||
    value === "get-many" ||
    value === "delete-data" ||
    value === "http-request" ||
    value === "create-record" ||
    value === "update-record" ||
    value === "delete-record"
  ) {
    return value;
  }
  return null;
}

function normalizeNodeConfigByKind(kind: WorkflowNodeKind, value: unknown): WorkflowNodeConfig {
  switch (kind) {
    case "trigger":
      return normalizeTriggerConfig(value);
    case "condition":
      return normalizeConditionConfig(value);
    case "get-one":
    case "get-many":
      return normalizeGetDataConfig(value);
    case "add-data":
      return normalizeAddDataConfig(value);
    case "update-data":
    case "delete-data":
    case "http-request":
      return normalizeActionConfig(value);
  }
}

function normalizeTriggerConfig(value: unknown): TriggerConfig {
  const current = isRecord(value) ? value : {};
  return {
    changedFieldsText: readStringValue(current.changedFieldsText),
  };
}

function normalizeConditionConfig(value: unknown): ConditionConfig {
  const current = isRecord(value) ? value : {};
  const rawBranches = Array.isArray(current.branches) ? current.branches : [];

  if (rawBranches.length > 0) {
    return {
      branches: rawBranches.map((item, index) => normalizeConditionBranch(item, index)),
    };
  }

  const legacyBranch = normalizeConditionBranch(
    {
      id: "branch-legacy-1",
      name: current.name,
      mode: current.mode,
      priority: current.priority,
      rules: current.rules,
      expression: current.expression,
      hitLabel: current.hitLabel,
    },
    0,
  );

  return {
    branches: [legacyBranch],
  };
}

function normalizeConditionBranch(value: unknown, index: number): ConditionBranch {
  const current = isRecord(value) ? value : {};
  const rawRules = Array.isArray(current.rules) ? current.rules : [];
  return {
    id: readStringValue(current.id) || `branch-${index + 1}`,
    name: readStringValue(current.name) || `条件分支 ${index + 1}`,
    mode:
      current.mode === "rules" || current.mode === "expression" || current.mode === "all"
        ? current.mode
        : "all",
    priority:
      typeof current.priority === "number" && Number.isFinite(current.priority)
        ? Math.max(1, current.priority)
        : index + 1,
    rules: rawRules
      .map((item) => normalizeBranchRule(item))
      .filter((item): item is BranchRule => item !== null),
    expression: readStringValue(current.expression),
    hitLabel: readStringValue(current.hitLabel),
  };
}

function normalizeBranchRule(value: unknown): BranchRule | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readStringValue(value.id) || `rule-${Date.now()}`;
  const operator = normalizeBranchRuleOperator(value.operator);
  return {
    id,
    parentId: readStringValue(value.parentId) || undefined,
    fieldKey: readStringValue(value.fieldKey),
    operator,
    rawValue: readStringValue(value.rawValue),
    valueType: value.valueType === "field" ? "field" : "value",
    sourceFieldKey: readStringValue(value.sourceFieldKey),
  };
}

function normalizeGetDataConfig(value: unknown): GetDataConfig {
  const current = isRecord(value) ? value : {};
  return {
    sourceMode: normalizeSourceMode(current.sourceMode),
    formUuid: readStringValue(current.formUuid),
    dataNodeId: readStringValue(current.dataNodeId),
    relatedFormPlaceholder: readStringValue(current.relatedFormPlaceholder),
    filterExpression: readStringValue(current.filterExpression),
    fieldSelection: readStringValue(current.fieldSelection),
  };
}

function normalizeAddDataConfig(value: unknown): AddDataConfig {
  const current = isRecord(value) ? value : {};
  const rawRows = Array.isArray(current.rows) ? current.rows : [];
  return {
    targetMode: normalizeTargetMode(current.targetMode),
    targetFormUuid: readStringValue(current.targetFormUuid),
    recordMode: normalizeRecordMode(current.recordMode),
    rows: rawRows
      .map((item) => normalizeFieldMappingRow(item))
      .filter((item): item is FieldMappingRow => item !== null),
    multipleSourceMode:
      current.multipleSourceMode === "form" ? "form" : "data-node",
    multipleSourceNodeId: readStringValue(current.multipleSourceNodeId),
    multipleFormula: readStringValue(current.multipleFormula),
  };
}

function normalizeActionConfig(value: unknown): ActionConfig {
  const current = isRecord(value) ? value : {};
  const rawRows = Array.isArray(current.rows) ? current.rows : [];
  return {
    targetFormUuid: readStringValue(current.targetFormUuid),
    matchRule: readStringValue(current.matchRule),
    rows: rawRows
      .map((item) => normalizeFieldMappingRow(item))
      .filter((item): item is FieldMappingRow => item !== null),
    bodyTemplate: readStringValue(current.bodyTemplate),
    method: readStringValue(current.method),
    url: readStringValue(current.url),
    headersText: readStringValue(current.headersText),
  };
}

function normalizeFieldMappingRow(value: unknown): FieldMappingRow | null {
  if (!isRecord(value)) {
    return null;
  }
  const fieldId = readStringValue(value.fieldId);
  if (!fieldId) {
    return null;
  }
  return {
    id: readStringValue(value.id) || `row-${fieldId}-${Date.now()}`,
    fieldId,
    valueType: normalizeValueType(value.valueType),
    rawValue: readStringValue(value.rawValue),
    sourceFieldKey: readStringValue(value.sourceFieldKey),
    formula: readStringValue(value.formula),
  };
}

function normalizeSourceMode(value: unknown): DataSourceMode {
  return value === "data-node" || value === "related-form" ? value : "form";
}

function normalizeTargetMode(value: unknown): AddTargetMode {
  return value === "subtable" ? "subtable" : "form";
}

function normalizeRecordMode(value: unknown): AddRecordMode {
  return value === "multiple" ? "multiple" : "single";
}

function normalizeValueType(value: unknown): FieldValueType {
  return value === "field" || value === "formula" ? value : "value";
}

function normalizeBranchRuleOperator(value: unknown): BranchRuleOperator {
  return value === "neq" ||
    value === "inAny" ||
    value === "notInAny" ||
    value === "hasValue" ||
    value === "noValue"
    ? value
    : "eq";
}

function readStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeKindLabel(kind: WorkflowNodeKind) {
  switch (kind) {
    case "trigger":
      return "触发器";
    case "condition":
      return "条件分支";
    case "add-data":
      return "新增数据";
    case "update-data":
      return "更新数据";
    case "get-one":
      return "获取单条数据";
    case "get-many":
      return "获取多条数据";
    case "delete-data":
      return "删除数据";
    case "http-request":
      return "连接器";
  }
}

function getSchemaForSourceNode(
  node: WorkflowNode,
  formSchemas: Record<string, FormSchemaDescriptor>,
  flowState: FlowState,
) {
  if (node.data.kind === "trigger") {
    return flowState.triggerFormUuid ? formSchemas[flowState.triggerFormUuid] : undefined;
  }

  if (node.data.kind === "get-one" || node.data.kind === "get-many") {
    const config = normalizeGetDataConfig(node.data.config);
    return config.formUuid ? formSchemas[config.formUuid] : undefined;
  }

  if (
    node.data.kind === "add-data" ||
    node.data.kind === "update-data" ||
    node.data.kind === "delete-data"
  ) {
    const config =
      node.data.kind === "add-data"
        ? normalizeAddDataConfig(node.data.config)
        : normalizeActionConfig(node.data.config);
    return config.targetFormUuid ? formSchemas[config.targetFormUuid] : undefined;
  }

  return undefined;
}

function nodeSummary(data: WorkflowNodeData) {
  if (data.kind === "trigger") {
    const config = normalizeTriggerConfig(data.config);
    return config.changedFieldsText ? `变化字段: ${config.changedFieldsText}` : "按触发事件执行";
  }
  if (data.kind === "condition") {
    const config = normalizeConditionConfig(data.config);
    return `${config.branches?.length ?? 1} 个条件分支`;
  }
  if (data.kind === "get-one" || data.kind === "get-many") {
    const config = normalizeGetDataConfig(data.config);
    return getSourceModeLabel(config.sourceMode ?? "form");
  }
  if (data.kind === "add-data") {
    const config = normalizeAddDataConfig(data.config);
    return config.recordMode === "multiple" ? "新增多条数据" : "新增单条数据";
  }
  if (data.kind === "http-request") {
    const config = normalizeActionConfig(data.config);
    return config.url || "未配置请求地址";
  }
  const config = normalizeActionConfig(data.config);
  return config.targetFormUuid || "未配置目标表单";
}

function conditionBranchSummary(branch: ConditionBranch) {
  if (branch.mode === "all") {
    return "全部通过";
  }
  if (branch.mode === "rules") {
    return `${branch.rules.length} 条规则`;
  }
  return branch.expression || "未配置分支表达式";
}

function getSourceModeLabel(mode: DataSourceMode) {
  if (mode === "data-node") {
    return "从数据节点获取";
  }
  if (mode === "related-form") {
    return "从关联表单获取";
  }
  return "从表单获取";
}

function isUpdateTriggerEvent(event: TriggerEvent) {
  return event === "before_update" || event === "after_update";
}

function formatDateLabel(value?: string) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function valueTypeLabel(valueType: FieldValueType) {
  if (valueType === "field") {
    return "字段";
  }
  if (valueType === "formula") {
    return "公式";
  }
  return "值";
}

function branchModeLabel(mode: "all" | "rules" | "expression") {
  if (mode === "rules") {
    return "按条件规则进入";
  }
  if (mode === "expression") {
    return "按表达式进入";
  }
  return "所有数据均可通过";
}

function branchOperatorLabel(operator: BranchRuleOperator) {
  return branchOperators.find((item) => item.id === operator)?.label ?? "等于";
}

function extractExpressionTokens(value: string) {
  const matches = value.matchAll(/\{\{([^}]+)\}\}/g);
  return [...matches]
    .map((match) => match[1]?.trim() ?? "")
    .filter((item) => item.length > 0);
}

function fieldTypeMatches(sourceType: string, targetType: string | undefined) {
  if (!targetType) {
    return true;
  }

  const sourceGroup = normalizeFieldTypeGroup(sourceType);
  const targetGroup = normalizeFieldTypeGroup(targetType);
  return sourceGroup === targetGroup;
}

function normalizeFieldTypeGroup(type: string) {
  if (type === "number") {
    return "number";
  }
  if (type === "date" || type === "dateRange") {
    return "date";
  }
  if (type === "select" || type === "radio") {
    return "single-choice";
  }
  if (type === "multiSelect" || type === "checkbox") {
    return "multi-choice";
  }
  if (type === "member") {
    return "member";
  }
  if (type === "department") {
    return "department";
  }
  return "text";
}
