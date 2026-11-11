"use client";
import { assertApiResult, assertApiEnvelope } from "@/shared/lib/api-request";

import { notifyRequestError } from "@/shared/lib/notify";
import { notify } from "@/shared/lib/notify";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Dropdown, Input, ListBox, Pagination, Select, Table, Tabs, Label, TextField, SearchField, ButtonGroup, type Selection } from "@heroui/react";

import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import { createAutomationFlow, deleteAutomationFlow, listAutomationFlowRuns, listAutomationFlows, listForms, retryAutomationFlowRun, retryAutomationVisit, resolveAutomationExecution, updateAutomationFlow, type ApiAutomationRun, type AutomationFlow, type AutomationFlowList, type FormSummary } from "@/features/automation-editor/api";
import { AutomationRunLogsModal } from "@/features/automation-editor/run-logs/AutomationRunLogsModal";
import { MySurface } from "@/shared/ui/MySurface";
import { FormSelect } from "@/features/form-controls/components/FormSelect";
import { Plus as AddIcon, FileText as FormIcon, ListUl as ListIcon, Ellipsis as MoreIcon, ArrowRotateLeft, Pencil as EditIcon } from "@gravity-ui/icons";
import { automationTypeLabels, getAutomationManagementType, fallbackStatusMeta, statusMeta, type AutomationManagementType, type AutomationStatus } from "../model/management-types";

type AutomationsPageClientProps = {
  appId: string;
  initialKeyword?: string;
};

type AutomationTypeFilter = "all" | AutomationManagementType;
const AUTOMATIONS_PAGE_SIZE = 10;
const emptyAutomationList: AutomationFlowList = {
  items: [],
  total: 0,
  enabled: 0,
  paused: 0,
};

export function AutomationsPageClient({ appId, initialKeyword = "" }: AutomationsPageClientProps) {
  const router = useRouter();
  const [automationList, setAutomationList] =
    useState<AutomationFlowList>(emptyAutomationList);
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [typeFilter, setTypeFilter] = useState<AutomationTypeFilter>("all");
  const [automationPage, setAutomationPage] = useState(1);
  const [selectedAutomationKeys, setSelectedAutomationKeys] =
    useState<Selection>(new Set());

  const [busyAutomationId, setBusyAutomationId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationFlow[] | null>(
    null,
  );
  const [bulkBusy, setBulkBusy] = useState(false);
  const actionsBusy = bulkBusy || busyAutomationId !== null;
  const [createOpen, setCreateOpen] = useState(false);
  const [createFormUuid, setCreateFormUuid] = useState("");
  const [createTrigger, setCreateTrigger] = useState<"form" | "button_click">(
    "form",
  );
  const [createAutomationName, setCreateAutomationName] = useState("");
  const [logsTarget, setLogsTarget] = useState<AutomationFlow | null>(null);
  const [runLogs, setRunLogs] = useState<ApiAutomationRun[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const logsRequestRef = useRef(0);
  const logsFlowRef = useRef<string | null>(null);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isMountedRef = useRef(false);
  const latestLoadRequestRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      latestLoadRequestRef.current += 1;
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!isMountedRef.current) return;
    const requestId = ++latestLoadRequestRef.current;
    setIsLoading(true);

    try {
      const [flowsResult, formsResult] = await Promise.all([
        listAutomationFlows({
          path: { appId },
          responseStyle: "fields",
        }),
        listForms({
          path: { appId },
          responseStyle: "fields",
        }),
      ]);

      assertApiResult(flowsResult);

      assertApiResult(formsResult);

      if (isMountedRef.current && requestId === latestLoadRequestRef.current) {
        setAutomationList(flowsResult.data.data);
        setForms(formsResult.data.data);
      }
    } catch (requestError) {
      if (isMountedRef.current && requestId === latestLoadRequestRef.current) {
        notifyRequestError(requestError, "集成自动化数据加载失败，请确认后端服务和数据库已启动。");
      }
    } finally {
      if (isMountedRef.current && requestId === latestLoadRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [appId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      latestLoadRequestRef.current += 1;
    };
  }, [loadData]);

  const formNameByUuid = useMemo(() => {
    return new Map(forms.map((form) => [form.id, form.name]));
  }, [forms]);

  const filteredAutomations = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return automationList.items.filter((flow) => {
      if (
        typeFilter !== "all" &&
        getAutomationManagementType(flow) !== typeFilter
      )
        return false;
      if (!normalizedKeyword) return true;
      const triggerFormName = flow.triggerFormUuid
        ? formNameByUuid.get(flow.triggerFormUuid)
        : "";

      return [
        flow.name,
        flow.description ?? "",
        flow.triggerLabel,
        triggerFormName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword);
    });
  }, [automationList.items, formNameByUuid, keyword, typeFilter]);
  const automationPageCount = Math.max(
    1,
    Math.ceil(filteredAutomations.length / AUTOMATIONS_PAGE_SIZE),
  );
  const activeAutomationPage = Math.min(automationPage, automationPageCount);
  const pagedAutomations = useMemo(() => {
    const start = (activeAutomationPage - 1) * AUTOMATIONS_PAGE_SIZE;
    return filteredAutomations.slice(start, start + AUTOMATIONS_PAGE_SIZE);
  }, [activeAutomationPage, filteredAutomations]);
  const selectedAutomations = useMemo(() => {
    if (selectedAutomationKeys === "all") {
      return filteredAutomations.filter((flow) => flow.flowType !== "process");
    }
    const selectedIds = new Set([...selectedAutomationKeys].map(String));
    return automationList.items.filter(
      (flow) => flow.flowType !== "process" && selectedIds.has(flow.id),
    );
  }, [automationList.items, filteredAutomations, selectedAutomationKeys]);
  const selectedEnabledCount = selectedAutomations.filter(
    (flow) => flow.status === "enabled",
  ).length;
  const selectedPausedCount = selectedAutomations.filter(
    (flow) => flow.status !== "enabled",
  ).length;

  function updateKeyword(value: string) {
    setSelectedAutomationKeys(new Set());
    setKeyword(value);
    setAutomationPage(1);
  }

  function updateTypeFilter(value: AutomationTypeFilter) {
    setSelectedAutomationKeys(new Set());
    setTypeFilter(value);
    setAutomationPage(1);
  }

  function updateAutomationPage(page: number) {
    setSelectedAutomationKeys(new Set());
    setAutomationPage(page);
  }

  function openCreateModal() {
    const formUuid = forms[0]?.id ?? "";
    setCreateFormUuid(formUuid);
    setCreateAutomationName(buildDefaultAutomationName(forms, formUuid));
    setCreateOpen(true);
  }

  function updateCreateForm(formUuid: string) {
    setCreateFormUuid(formUuid);
    setCreateAutomationName(buildDefaultAutomationName(forms, formUuid));
  }

  async function handleCreateAutomation() {
    if (!createFormUuid) {
      notify.error("请先创建表单，再配置集成自动化。");
      return;
    }
    const name = createAutomationName.trim();
    if (!name) {
      notify.error("请输入自动化名称。");
      return;
    }

    startTransition(async () => {
      try {
        const { data, error , response: httpResponse0 } = await createAutomationFlow({
          path: { appId },
          body: {
            name,
            triggerFormUuid: createFormUuid,
            triggerEvents:
              createTrigger === "button_click" ? ["button_click"] : [],
          },
          responseStyle: "fields",
        });

        assertApiEnvelope(data, error, httpResponse0);
        const createdFlow = data.data as AutomationFlow;

        setAutomationList((current) => ({
          ...current,
          items: [createdFlow, ...current.items],
          total: current.total + 1,
          paused: current.paused + 1,
        }));
        setCreateOpen(false);
        notify.success("集成自动化已创建");
        router.push(`/${appId}/automations/${createdFlow.id}`);
      } catch (requestError) {
        notifyRequestError(requestError, "创建集成自动化失败，请检查触发表单配置。");
      }
    });
  }

  async function handleToggleAutomation(flow: AutomationFlow) {
    const nextStatus: AutomationStatus =
      flow.status === "enabled" ? "paused" : "enabled";

    setBusyAutomationId(flow.id);

    try {
      const { data, error } = await updateAutomationFlow({
        path: { automationId: flow.id },
        body: { status: nextStatus },
        responseStyle: "fields",
      });

      if (error || !data || data.code !== 0 || !data.data) {
        throw error ?? new Error(data?.message || "更新自动化状态失败");
      }
      const updatedFlow = data.data as AutomationFlow;

      setAutomationList((current) =>
        rebuildAutomationList(current, updatedFlow),
      );
      notify.success(
        nextStatus === "enabled" ? "自动化已启动" : "自动化已停止",
      );
    } catch (cause) {
      notifyRequestError(cause, "更新自动化状态失败", {
        description:
          cause instanceof Error
            ? cause.message
            : typeof cause === "object" && cause !== null && "message" in cause
              ? String(cause.message)
              : "请重新配置流程",
      });
    } finally {
      setBusyAutomationId(null);
    }
  }

  async function handleBulkToggle(status: AutomationStatus) {
    if (bulkBusy || busyAutomationId !== null) return;
    const targets = selectedAutomations.filter(
      (flow) => flow.status !== status,
    );
    if (!targets.length) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(
      targets.map(async (flow) => {
        const { data, error } = await updateAutomationFlow({
          path: { automationId: flow.id },
          body: { status },
          responseStyle: "fields",
        });
        if (error || !data || data.code !== 0 || !data.data) {
          throw error ?? new Error(data?.message || "更新自动化状态失败");
        }
        return data.data as AutomationFlow;
      }),
    );
    const updated = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (updated.length) {
      setAutomationList((current) =>
        updated.reduce(rebuildAutomationList, current),
      );
    }
    const failedCount = results.length - updated.length;
    if (failedCount) {
      notify.error(
        `批量${status === "enabled" ? "启动" : "停止"}完成：成功 ${updated.length} 条，失败 ${failedCount} 条。`,
      );
    } else {
      notify.success(
        `已${status === "enabled" ? "启动" : "停止"} ${updated.length} 条自动化`,
      );
    }
    setSelectedAutomationKeys(
      new Set(
        targets
          .filter((_, index) => results[index].status === "rejected")
          .map((flow) => flow.id),
      ),
    );
    setBulkBusy(false);
  }

  async function handleBulkDelete() {
    if (!deleteTarget?.length || bulkBusy || busyAutomationId !== null) return;
    setBulkBusy(true);
    const deletable = deleteTarget.filter(
      (flow) => flow.flowType !== "process",
    );
    const results = await Promise.allSettled(
      deletable.map(async (flow) => {
        const result = await deleteAutomationFlow({
          path: { automationId: flow.id },
          responseStyle: "fields",
        });
        assertApiResult(result);
        return flow;
      }),
    );
    const deleted = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (deleted.length) {
      setAutomationList((current) =>
        deleted.reduce(removeAutomationFromList, current),
      );
    }
    const failedCount = results.length - deleted.length;
    setDeleteTarget(null);
    setSelectedAutomationKeys(
      new Set(
        deletable
          .filter((_, index) => results[index].status === "rejected")
          .map((flow) => flow.id),
      ),
    );
    if (failedCount) {
      notify.error(
        `批量删除完成：成功 ${deleted.length} 条，失败 ${failedCount} 条。`,
        {
          description: results.flatMap((result, index) => {
            if (result.status !== "rejected") return [];
            const message = result.reason instanceof Error
              ? result.reason.message
              : "删除失败，请稍后重试";
            return [`${deletable[index].name}：${message}`];
          }).join("；"),
        },
      );
    } else {
      notify.success(`已删除 ${deleted.length} 条集成自动化`);
    }
    setBulkBusy(false);
  }

  const fetchRunLogs = useCallback(async (flowId: string) => {
    if (logsFlowRef.current !== flowId) return;
    const requestId = ++logsRequestRef.current;
    setLogsLoading(true);
    try {
      const { data, error, response } = await listAutomationFlowRuns({
        path: { automationId: flowId }, responseStyle: "fields",
      });
      assertApiEnvelope(data, error, response);
      if (requestId === logsRequestRef.current && isMountedRef.current) setRunLogs(data.data);
    } catch (requestError) {
      if (requestId === logsRequestRef.current && isMountedRef.current) {
        notifyRequestError(requestError, "运行日志加载失败");
      }
    } finally {
      if (requestId === logsRequestRef.current && isMountedRef.current) setLogsLoading(false);
    }
  }, []);

  const refreshRunLogs = useCallback(() => {
    if (logsFlowRef.current) void fetchRunLogs(logsFlowRef.current);
  }, [fetchRunLogs]);

  async function openRunLogs(flow: AutomationFlow) {
    logsFlowRef.current = flow.id;
    setLogsTarget(flow);
    setRunLogs([]);
    await fetchRunLogs(flow.id);
  }

  function closeRunLogs() {
    logsFlowRef.current = null;
    logsRequestRef.current += 1;
    setLogsTarget(null);
    setLogsLoading(false);
  }

  async function handleRetryRun(flowId: string, runId: string) {
    setRetryingKey(`run:${runId}`);
    try {
      const { data, error , response: httpResponse5 } = await retryAutomationFlowRun({
        path: { automationId: flowId, runId },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, httpResponse5);
      notify.success("已重新触发自动化");
      if (logsTarget?.id === flowId) {
        await fetchRunLogs(flowId);
      }
    } catch (requestError) {
      notifyRequestError(requestError, "重新触发失败");
    } finally {
      setRetryingKey(null);
    }
  }

  async function handleResolveRun(
    flowId: string,
    runId: string,
    action: "retry" | "cancel",
  ) {
    const message =
      action === "retry"
        ? "请先核实外部接口结果。继续将重新调用待核实节点，可能重复写入或重复下单，是否接受该风险？"
        : "取消本次运行并终止剩余执行？已发生的外部副作用不会撤销。";
    if (!window.confirm(message)) return;
    setRetryingKey(`run:${runId}`);
    try {
      const { data, error , response: httpResponse6 } = await resolveAutomationExecution({
        path: { automationId: flowId, runId },
        body: { action, acceptDuplicateRisk: action === "retry" },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, httpResponse6);
      notify.success("核实处理已记录");
      if (logsTarget?.id === flowId) await fetchRunLogs(flowId);
    } catch (requestError) {
      notifyRequestError(requestError, "核实处理失败，请检查管理员权限和运行状态");
    } finally {
      setRetryingKey(null);
    }
  }

  async function handleRetryNode(flowId: string, runId: string, logId: string) {
    setRetryingKey(`node:${runId}:${logId}`);
    try {
      const { data, error , response: httpResponse7 } = await retryAutomationVisit({
        path: { automationId: flowId, runId, logId },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, httpResponse7);
      notify.success("已重试所选节点访问及其下游");
      if (logsTarget?.id === flowId) {
        await fetchRunLogs(flowId);
      }
    } catch (requestError) {
      notifyRequestError(requestError, "节点重试失败");
    } finally {
      setRetryingKey(null);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-4 text-[var(--color-text-primary)]">
      {/* 头部 */}
      <section className="flex justify-between">
        <div className="flex gap-4 items-center">
          <div className="min-w-[170px] shrink-0">
            <h1 className="text-xl font-semibold tracking-normal text-[var(--color-text-primary)]">
              自动化流程
            </h1>
            <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
              管理触发器与流程自动化规则
            </p>
          </div>
          {/* 搜索自动化 */}
          <SearchField name="search">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                aria-label="搜索自动化"
                className="w-[280px]"
                placeholder="搜索自动化"
                value={keyword}
                onChange={(event) => updateKeyword(event.currentTarget.value)}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>

        <div className="flex gap-4 items-center">
          {/* 统计信息 */}
          <div className="flex shrink-0 items-center gap-2">
            <Metric label="总数" value={automationList.total} />
            <Metric
              label="已启动"
              value={automationList.enabled}
              tone="green"
            />
            <Metric label="已停止" value={automationList.paused} tone="amber" />
          </div>

          {/* 操作按钮 */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              isIconOnly
              variant="outline"
              aria-label="刷新自动化列表"
              onClick={() => void loadData()}
              isDisabled={isLoading || isPending || actionsBusy}
            >
              <ArrowRotateLeft />
            </Button>
            <Button
              isIconOnly
              aria-label="新增集成自动化"
              onClick={openCreateModal}
              isDisabled={forms.length === 0}
            >
              <AddIcon />
            </Button>
          </div>
          <div className="shrink-0">
            <Tabs
              selectedKey={typeFilter}
              onSelectionChange={(key) =>
                updateTypeFilter(key as AutomationTypeFilter)
              }
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="自动化类型筛选">
                  <Tabs.Tab id="all" className="px-3 text-xs whitespace-nowrap">
                    全部
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab
                    id="trigger"
                    className="px-3 text-xs whitespace-nowrap"
                  >
                    触发类型
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab
                    id="process"
                    className="px-3 text-xs whitespace-nowrap"
                  >
                    流程类型
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab
                    id="manual"
                    className="px-3 text-xs whitespace-nowrap"
                  >
                    手动类型
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>
        </div>
      </section>

      {forms.length === 0 ? (
        <div className="theme-panel rounded-lg ">
          当前应用还没有可作为触发目标的表单。请先创建并设计表单，再创建集成自动化。
        </div>
      ) : null}

      {filteredAutomations.length > 0 ? (
        <div className="">
          {selectedAutomations.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-[var(--color-text-secondary)]">
                已选 {selectedAutomations.length} 条
              </span>
              <ButtonGroup aria-label="批量操作">
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={actionsBusy || selectedPausedCount === 0}
                  onPress={() => void handleBulkToggle("enabled")}
                >
                  启动所选
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={actionsBusy || selectedEnabledCount === 0}
                  onPress={() => void handleBulkToggle("paused")}
                >
                  停止所选
                </Button>
                <Button
                  size="sm"
                  className="text-[var(--color-danger)]"
                  isDisabled={
                    actionsBusy ||
                    !selectedAutomations.some(
                      (flow) => flow.flowType !== "process",
                    )
                  }
                  onPress={() =>
                    setDeleteTarget(
                      selectedAutomations.filter(
                        (flow) => flow.flowType !== "process",
                      ),
                    )
                  }
                >
                  删除所选
                </Button>
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={actionsBusy}
                  onPress={() => setSelectedAutomationKeys(new Set())}
                >
                  清除选择
                </Button>
              </ButtonGroup>
            </div>
          ) : null}
          <Table className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
            <Table.ScrollContainer className="min-h-0 max-w-full overflow-auto">
              <Table.Content
                aria-label="集成自动化规则列表"
                className="min-w-[1020px]"
                selectionMode="multiple"
                selectionBehavior="toggle"
                disabledKeys={pagedAutomations
                  .filter((flow) => flow.flowType === "process")
                  .map((flow) => flow.id)}
                disabledBehavior="selection"
                selectedKeys={selectedAutomationKeys}
                onSelectionChange={(keys) => {
                  if (bulkBusy || busyAutomationId !== null) return;
                  setSelectedAutomationKeys(
                    keys === "all"
                      ? new Set(pagedAutomations
                        .filter((flow) => flow.flowType !== "process")
                        .map((flow) => flow.id))
                      : new Set([...keys].filter((key) => automationList.items.some(
                        (flow) => flow.id === String(key) && flow.flowType !== "process",
                      ))),
                  );
                }}
              >
                <Table.Header>
                  <Table.Column id="select" className="w-12">
                    <Checkbox
                      slot="selection"
                      aria-label="选择当前页全部自动化"
                      isDisabled={actionsBusy}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  </Table.Column>
                  <Table.Column id="name" isRowHeader>
                    自动化名称
                  </Table.Column>
                  <Table.Column id="type">自动化类型</Table.Column>
                  <Table.Column id="status">状态</Table.Column>
                  <Table.Column id="form">触发表单</Table.Column>
                  <Table.Column id="trigger">触发事件</Table.Column>
                  <Table.Column id="updated">更新人&更新时间</Table.Column>
                  <Table.Column id="created">创建人&创建时间</Table.Column>
                  <Table.Column id="actions">操作</Table.Column>
                </Table.Header>
                <Table.Body>
                  {pagedAutomations.map((flow) => (
                    <AutomationRow
                      key={flow.id}
                      flow={flow}
                      formName={getTriggerFormName(flow, formNameByUuid)}
                      isBusy={actionsBusy}
                      onEdit={() =>
                        router.push(`/${appId}/automations/${flow.id}`)
                      }
                      onLogs={() => void openRunLogs(flow)}
                      onToggle={() => void handleToggleAutomation(flow)}
                      onDelete={() => setDeleteTarget([flow])}
                    />
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
            <Table.Footer className="border-t border-[var(--color-border)]">
              <Pagination
                size="sm"
                aria-label="自动化规则分页"
                className="w-full"
              >
                <Pagination.Summary>
                  共 {filteredAutomations.length} 条，每页{" "}
                  {AUTOMATIONS_PAGE_SIZE} 条
                </Pagination.Summary>
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      aria-label="上一页"
                      isDisabled={actionsBusy || activeAutomationPage === 1}
                      onPress={() =>
                        updateAutomationPage(activeAutomationPage - 1)
                      }
                    >
                      <Pagination.PreviousIcon />
                      上一页
                    </Pagination.Previous>
                  </Pagination.Item>
                  {Array.from(
                    { length: automationPageCount },
                    (_, index) => index + 1,
                  ).map((page) => (
                    <Pagination.Item key={page}>
                      <Pagination.Link
                        isActive={page === activeAutomationPage}
                        isDisabled={actionsBusy}
                        onPress={() => updateAutomationPage(page)}
                      >
                        {page}
                      </Pagination.Link>
                    </Pagination.Item>
                  ))}
                  <Pagination.Item>
                    <Pagination.Next
                      aria-label="下一页"
                      isDisabled={
                        actionsBusy ||
                        activeAutomationPage === automationPageCount
                      }
                      onPress={() =>
                        updateAutomationPage(activeAutomationPage + 1)
                      }
                    >
                      下一页
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </Table.Footer>
          </Table>
        </div>
      ) : (
        <EmptyState
          hasKeyword={keyword.trim().length > 0 || typeFilter !== "all"}
        />
      )}

      {createOpen ? (
        <Modal.Backdrop
          isOpen={createOpen}
          onOpenChange={setCreateOpen}
          className="theme-modal-backdrop"
          isDismissable
        >
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>新建集成自动化</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4">
                {/* 触发类型 */}
                <TextField>
                  <Label>触发类型</Label>
                  <Select
                    aria-label="触发类型"
                    selectedKey={createTrigger}
                    onSelectionChange={(key) =>
                      setCreateTrigger(
                        key === "button_click" ? "button_click" : "form",
                      )
                    }
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="form">表单事件</ListBox.Item>
                        <ListBox.Item id="button_click">按钮触发</ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </TextField>

                {/* 表单选择 */}
                <FormSelect
                  label="表单"
                  appId={appId}
                  forms={forms}
                  formTypes={["normal", "workflow"]}
                  allowCrossApp={false}
                  value={createFormUuid}
                  onChange={updateCreateForm}
                  placeholder="选择触发表单"
                />
                {/* 自动化标题 */}
                <TextField>
                  <Label>自动化标题</Label>
                  <Input
                    aria-label="自动化标题"
                    fullWidth
                    value={createAutomationName}
                    onChange={(event) =>
                      setCreateAutomationName(event.currentTarget.value)
                    }
                  />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => void handleCreateAutomation()}
                  isDisabled={isPending || !createFormUuid}
                >
                  创建
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      ) : null}

      <AlertDialog.Backdrop
        isOpen={deleteTarget !== null}
        onOpenChange={(isOpen) => !isOpen && !bulkBusy && setDeleteTarget(null)}
        className="theme-modal-backdrop"
      >
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>删除集成自动化</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="">
              {deleteTarget?.length === 1
                ? `“${deleteTarget[0].name}”及其运行日志将一并删除，且不可恢复。`
                : `将删除所选的 ${deleteTarget?.length ?? 0} 条自动化及其运行日志，且不可恢复。`}
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                关联的自定义按钮将保留，其集成自动化绑定会被清空。
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer className="">
              <Button
                variant="ghost"
                isDisabled={bulkBusy}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </Button>
              <Button
                onClick={() => void handleBulkDelete()}
                isDisabled={bulkBusy || busyAutomationId !== null}
              >
                删除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {logsTarget ? (
        <AutomationRunLogsModal
          key={logsTarget.id}
          name={logsTarget.name}
          runs={runLogs}
          loading={logsLoading}
          retryingKey={retryingKey}
          onClose={closeRunLogs}
          onRefresh={refreshRunLogs}
          onRetryRun={(runId) => void handleRetryRun(logsTarget.id, runId)}
          onRetryNode={(runId, visitId) => void handleRetryNode(logsTarget.id, runId, visitId)}
          onResolve={(runId, action) => void handleResolveRun(logsTarget.id, runId, action)}
        />
      ) : null}
    </div>
  );
}
function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "green" | "amber";
}) {
  const toneClassName =
    tone === "green"
      ? "text-[var(--color-success)]"
      : tone === "amber"
        ? "text-[var(--color-warning)]"
        : "text-[var(--color-text-primary)]";

  return (
    <MySurface className="flex gap-2 items-center p-2">
      <span className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className={`text-base font-semibold ${toneClassName}`}>
        {value}
      </span>
    </MySurface>
  );
}

function AutomationRow({
  flow,
  formName,
  isBusy,
  onEdit,
  onLogs,
  onToggle,
  onDelete,
}: {
  flow: AutomationFlow;
  formName: string;
  isBusy: boolean;
  onEdit: () => void;
  onLogs: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const status = statusMeta[flow.status] ?? fallbackStatusMeta;
  const managementType = getAutomationManagementType(flow);

  return (
    <Table.Row id={flow.id} className="align-middle">
      <Table.Cell>
        <Checkbox
          slot="selection"
          aria-label={`选择 ${flow.name}`}
          isDisabled={isBusy || flow.flowType === "process"}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      </Table.Cell>
      <Table.Cell className="min-w-[260px]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
            <FormIcon />
          </span>
          <div className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">
            {flow.name}
          </div>
        </div>
      </Table.Cell>
      <Table.Cell>
        <span
          className="inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]"
          style={{
            backgroundColor: `var(--automation-type-${managementType}-background)`,
            color: `var(--automation-type-${managementType}-foreground)`,
          }}
        >
          {automationTypeLabels[managementType]}
        </span>
      </Table.Cell>
      <Table.Cell>
        <span
          className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium ${status.className}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />
          {status.label}
        </span>
      </Table.Cell>
      <Table.Cell className="text-[var(--color-text-primary)]">
        {formName}
      </Table.Cell>
      <Table.Cell className="text-[var(--color-text-primary)]">
        {flow.triggerLabel}
      </Table.Cell>
      <Table.Cell>
        <div className="min-w-[150px]">
          <div className="truncate text-sm text-[var(--color-text-primary)]" title={flow.updatedBy}>
            {flow.updatedBy}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {formatDateTime(flow.updatedAt)}
          </div>
        </div>
      </Table.Cell>
      <Table.Cell>
        <div className="min-w-[150px]">
          <div className="truncate text-sm text-[var(--color-text-primary)]" title={flow.createdBy}>
            {flow.createdBy}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {formatDateTime(flow.createdAt)}
          </div>
        </div>
      </Table.Cell>
      <Table.Cell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={`编辑 ${flow.name}`}
            isDisabled={isBusy}
            onPress={onEdit}
          >
            <EditIcon />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={`查看 ${flow.name} 运行日志`}
            isDisabled={isBusy}
            onPress={onLogs}
          >
            <ListIcon />
          </Button>
          <Dropdown>
            <Dropdown.Trigger
              aria-label={`${flow.name} 更多操作`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-soft)]"
            >
              <MoreIcon />
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu
                aria-label={`${flow.name} 更多操作菜单`}
                className="min-w-[150px]"
              >
                <Dropdown.Item
                  id="toggle"
                  isDisabled={isBusy}
                  onAction={onToggle}
                >
                  {flow.status === "enabled" ? "停止" : "启动"}
                </Dropdown.Item>
                <Dropdown.Item
                  id="delete"
                  isDisabled={isBusy || flow.flowType === "process"}
                  className="text-[var(--color-danger)]"
                  onAction={onDelete}
                >
                  {flow.flowType === "process" ? "随流程表单删除" : "删除"}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </Table.Cell>
    </Table.Row>
  );
}

function EmptyState({ hasKeyword }: { hasKeyword: boolean }) {
  return (
    <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center px-5 py-10 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
        <ListIcon />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">
        {hasKeyword ? "没有匹配的自动化" : "还没有集成自动化"}
      </h3>
      <p className="mt-2 max-w-[420px] ">
        {hasKeyword ? "调整搜索条件后再查看。" : "暂无自动化"}
      </p>
    </div>
  );
}

function rebuildAutomationList(
  current: AutomationFlowList,
  updatedFlow: AutomationFlow,
): AutomationFlowList {
  const items = current.items.map((flow) =>
    flow.id === updatedFlow.id ? updatedFlow : flow,
  );

  return buildAutomationList(items);
}

function removeAutomationFromList(
  current: AutomationFlowList,
  removedFlow: AutomationFlow,
): AutomationFlowList {
  return buildAutomationList(
    current.items.filter((flow) => flow.id !== removedFlow.id),
  );
}

function buildAutomationList(items: AutomationFlow[]): AutomationFlowList {
  return {
    items,
    total: items.length,
    enabled: items.filter((flow) => flow.status === "enabled").length,
    paused: items.filter((flow) => flow.status === "paused").length,
  };
}

function getTriggerFormName(
  flow: AutomationFlow,
  formNameByUuid: Map<string, string>,
) {
  if (!flow.triggerFormUuid) {
    return "未配置";
  }

  return formNameByUuid.get(flow.triggerFormUuid) ?? flow.triggerFormUuid;
}

function buildDefaultAutomationName(forms: FormSummary[], formUuid: string) {
  return forms.find((form) => form.id === formUuid)?.name ?? "未命名自动化";
}

function formatDateTime(value: string) {
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
