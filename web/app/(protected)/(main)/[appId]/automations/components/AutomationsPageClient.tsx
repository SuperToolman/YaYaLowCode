"use client";
import { notify } from "@lib/notify";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dropdown,
  Input,
  ListBox,
  Pagination,
  Select,
  Table,
  Tabs,
  Tooltip,
} from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import {
  createAutomationFlow,
  deleteAutomationFlow,
  listAutomationFlowRuns,
  listAutomationFlows,
  listForms,
  retryAutomationFlowRun,
  retryAutomationFlowRunNode,
  updateAutomationFlow,
  type ApiAutomationRun,
  type ApiAutomationRunNode,
  type AutomationFlow,
  type AutomationFlowList,
  type FormSummary,
} from "@/features/automation-editor/api";
import { MySurface } from "@/components/ui/MySurface";
import {
  Plus as AddIcon,
  FileText as FormIcon,
  ListUl as ListIcon,
  Ellipsis as MoreIcon,
  ArrowRotateLeft,
} from "@gravity-ui/icons";
import { statusMeta, type AutomationStatus } from "./AutomationShared";

type AutomationsPageClientProps = {
  appId: string;
};

type RunLogFilter = "all" | "failed" | "success" | "running";
type AutomationTypeFilter = "all" | "trigger" | "process";
const AUTOMATIONS_PAGE_SIZE = 10;
const emptyAutomationList: AutomationFlowList = {
  items: [],
  total: 0,
  enabled: 0,
  paused: 0,
};

export function AutomationsPageClient({ appId }: AutomationsPageClientProps) {
  const router = useRouter();
  const [automationList, setAutomationList] =
    useState<AutomationFlowList>(emptyAutomationList);
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<AutomationTypeFilter>("all");
  const [automationPage, setAutomationPage] = useState(1);
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAutomationId, setBusyAutomationId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationFlow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createFormUuid, setCreateFormUuid] = useState("");
  const [createAutomationName, setCreateAutomationName] = useState("");
  const [logsTarget, setLogsTarget] = useState<AutomationFlow | null>(null);
  const [runLogs, setRunLogs] = useState<ApiAutomationRun[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsFilter, setLogsFilter] = useState<RunLogFilter>("all");
  const [visibleRunCount, setVisibleRunCount] = useState(10);
  const [expandedJsonKeys, setExpandedJsonKeys] = useState<
    Record<string, boolean>
  >({});
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
    setErrorMessage("");
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

      if (
        flowsResult.error ||
        !flowsResult.data ||
        flowsResult.data.code !== 0 ||
        !flowsResult.data.data
      ) {
        throw new Error("load automation flows failed");
      }

      if (
        formsResult.error ||
        !formsResult.data ||
        formsResult.data.code !== 0 ||
        !formsResult.data.data
      ) {
        throw new Error("load forms failed");
      }

      if (
        isMountedRef.current &&
        requestId === latestLoadRequestRef.current
      ) {
        setAutomationList(flowsResult.data.data);
        setForms(formsResult.data.data);
      }
    } catch {
      if (
        isMountedRef.current &&
        requestId === latestLoadRequestRef.current
      ) {
        setErrorMessage(
          "集成自动化数据加载失败，请确认后端服务和数据库已启动。",
        );
      }
    } finally {
      if (
        isMountedRef.current &&
        requestId === latestLoadRequestRef.current
      ) {
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
      if (typeFilter !== "all" && flow.flowType !== typeFilter) return false;
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

  function updateKeyword(value: string) {
    setKeyword(value);
    setAutomationPage(1);
  }

  function updateTypeFilter(value: AutomationTypeFilter) {
    setTypeFilter(value);
    setAutomationPage(1);
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
      setErrorMessage("请先创建表单，再配置集成自动化。");
      return;
    }
    const name = createAutomationName.trim();
    if (!name) {
      setErrorMessage("请输入自动化名称。");
      return;
    }

    setErrorMessage("");

    startTransition(async () => {
      try {
        const { data, error } = await createAutomationFlow({
          path: { appId },
          body: {
            name,
            triggerFormUuid: createFormUuid,
          },
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("create automation flow failed");
        }
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
      } catch {
        setErrorMessage("创建集成自动化失败，请检查触发表单配置。");
      }
    });
  }

  async function handleToggleAutomation(flow: AutomationFlow) {
    const nextStatus: AutomationStatus =
      flow.status === "enabled" ? "paused" : "enabled";

    setBusyAutomationId(flow.id);
    setErrorMessage("");

    try {
      const { data, error } = await updateAutomationFlow({
        path: { automationId: flow.id },
        body: { status: nextStatus },
        responseStyle: "fields",
      });

      if (error || !data || data.code !== 0 || !data.data) {
        throw new Error("update automation status failed");
      }
      const updatedFlow = data.data as AutomationFlow;

      setAutomationList((current) =>
        rebuildAutomationList(current, updatedFlow),
      );
      notify.success(nextStatus === "enabled" ? "自动化已启动" : "自动化已停止");
    } catch {
      setErrorMessage("更新自动化状态失败。");
    } finally {
      setBusyAutomationId(null);
    }
  }

  async function handleDeleteAutomation() {
    if (!deleteTarget) {
      return;
    }

    setBusyAutomationId(deleteTarget.id);
    setErrorMessage("");

    try {
      const { data, error } = await deleteAutomationFlow({
        path: { automationId: deleteTarget.id },
        responseStyle: "fields",
      });

      const result = data as { code?: number } | undefined;
      if (error || !result || result.code !== 0) {
        throw new Error("delete automation flow failed");
      }

      setAutomationList((current) =>
        removeAutomationFromList(current, deleteTarget),
      );
      setDeleteTarget(null);
      notify.success("集成自动化已删除");
    } catch {
      setErrorMessage("删除集成自动化失败。");
    } finally {
      setBusyAutomationId(null);
    }
  }

  async function openRunLogs(flow: AutomationFlow) {
    setLogsTarget(flow);
    setLogsLoading(true);
    setLogsFilter("all");
    setVisibleRunCount(10);
    setExpandedJsonKeys({});
    try {
      const { data, error } = await listAutomationFlowRuns({
        path: { automationId: flow.id },
        responseStyle: "fields",
      });
      if (error || !data || data.code !== 0 || !data.data) {
        throw new Error("load automation runs failed");
      }
      setRunLogs(data.data);
    } catch {
      setRunLogs([]);
      notify.error("运行日志加载失败");
    } finally {
      setLogsLoading(false);
    }
  }

  async function handleRetryRun(flowId: string, runId: string) {
    setRetryingKey(`run:${runId}`);
    try {
      const { data, error } = await retryAutomationFlowRun({
        path: { automationId: flowId, runId },
        responseStyle: "fields",
      });
      if (error || !data || data.code !== 0) {
        throw new Error("retry run failed");
      }
      notify.success("已重新触发自动化");
      if (logsTarget?.id === flowId) {
        await openRunLogs(logsTarget);
      }
    } catch {
      notify.error("重新触发失败");
    } finally {
      setRetryingKey(null);
    }
  }

  async function handleRetryNode(
    flowId: string,
    runId: string,
    nodeKey: string,
  ) {
    setRetryingKey(`node:${runId}:${nodeKey}`);
    try {
      const { data, error } = await retryAutomationFlowRunNode({
        path: { automationId: flowId, runId, nodeKey },
        responseStyle: "fields",
      });
      if (error || !data || data.code !== 0) {
        throw new Error("retry node failed");
      }
      notify.success("已发起错误节点重试");
      if (logsTarget?.id === flowId) {
        await openRunLogs(logsTarget);
      }
    } catch {
      notify.error("节点重试失败");
    } finally {
      setRetryingKey(null);
    }
  }

  function toggleJsonBlock(key: string) {
    setExpandedJsonKeys((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  const filteredRunLogs = useMemo(() => {
    if (logsFilter === "all") {
      return runLogs;
    }
    return runLogs.filter((run) => run.status === logsFilter);
  }, [logsFilter, runLogs]);

  const visibleRunLogs = useMemo(
    () => filteredRunLogs.slice(0, visibleRunCount),
    [filteredRunLogs, visibleRunCount],
  );

  function sortRunNodes(nodes: ApiAutomationRunNode[]) {
    return [...nodes].sort((left, right) => {
      if (left.status === right.status) {
        return 0;
      }
      if (left.status === "failed") {
        return -1;
      }
      if (right.status === "failed") {
        return 1;
      }
      if (left.status === "running") {
        return -1;
      }
      if (right.status === "running") {
        return 1;
      }
      return 0;
    });
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-4 text-[var(--color-text-primary)]">
      <section className="flex items-center gap-3 overflow-x-auto rounded-xl">
        <div className="min-w-[170px] shrink-0">
          <h1 className="text-xl font-semibold tracking-normal text-[var(--color-text-primary)]">
            自动化流程
          </h1>
          <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
            管理触发器与流程自动化规则
          </p>
        </div>
        <Input
          aria-label="搜索自动化"
          className="min-w-[220px] flex-1"
          placeholder="搜索自动化"
          value={keyword}
          onChange={(event) => updateKeyword(event.currentTarget.value)}
        />
        <div className="flex shrink-0 items-center gap-2">
          <Metric label="总数" value={automationList.total} />
          <Metric label="已启动" value={automationList.enabled} tone="green" />
          <Metric label="已停止" value={automationList.paused} tone="amber" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            isIconOnly
            variant="outline"
            aria-label="刷新自动化列表"
            onClick={() => void loadData()}
            isDisabled={isLoading || isPending}
          >
            <ArrowRotateLeft/>
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
                <Tabs.Tab id="trigger" className="px-3 text-xs whitespace-nowrap">
                  触发类型
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="process" className="px-3 text-xs whitespace-nowrap">
                  流程类型
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        </div>
      </section>

      {forms.length === 0 ? (
        <div className="theme-panel rounded-lg ">
          当前应用还没有可作为触发目标的表单。请先创建并设计表单，再创建集成自动化。
        </div>
      ) : null}

      {filteredAutomations.length > 0 ? (
        <div className="min-h-0 flex-1">
          <Table className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
              <Table.ScrollContainer className="min-h-0 max-w-full overflow-auto">
                <Table.Content aria-label="集成自动化规则列表" className="min-w-[980px]">
                  <Table.Header>
                    <Table.Column id="name" isRowHeader>自动化名称</Table.Column>
                    <Table.Column id="status">状态</Table.Column>
                    <Table.Column id="form">触发表单</Table.Column>
                    <Table.Column id="trigger">触发事件</Table.Column>
                    <Table.Column id="nodes">节点</Table.Column>
                    <Table.Column id="updatedBy">更新人</Table.Column>
                    <Table.Column id="updatedAt">更新时间</Table.Column>
                    <Table.Column id="actions">操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                {pagedAutomations.map((flow) => (
                  <AutomationRow
                    key={flow.id}
                    flow={flow}
                    formName={getTriggerFormName(flow, formNameByUuid)}
                    isBusy={busyAutomationId === flow.id}
                    onEdit={() =>
                      router.push(`/${appId}/automations/${flow.id}`)
                    }
                    onLogs={() => void openRunLogs(flow)}
                    onToggle={() => void handleToggleAutomation(flow)}
                    onDelete={() => setDeleteTarget(flow)}
                  />
                ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
              <Table.Footer className="border-t border-[var(--color-border)]">
                <Pagination size="sm" aria-label="自动化规则分页" className="w-full">
                  <Pagination.Summary>
                    共 {filteredAutomations.length} 条，每页 {AUTOMATIONS_PAGE_SIZE} 条
                  </Pagination.Summary>
                  <Pagination.Content>
                    <Pagination.Item>
                      <Pagination.Previous
                        aria-label="上一页"
                        isDisabled={activeAutomationPage === 1}
                        onPress={() => setAutomationPage(activeAutomationPage - 1)}
                      >
                        <Pagination.PreviousIcon />
                        上一页
                      </Pagination.Previous>
                    </Pagination.Item>
                    {Array.from({ length: automationPageCount }, (_, index) => index + 1).map((page) => (
                      <Pagination.Item key={page}>
                        <Pagination.Link
                          isActive={page === activeAutomationPage}
                          onPress={() => setAutomationPage(page)}
                        >
                          {page}
                        </Pagination.Link>
                      </Pagination.Item>
                    ))}
                    <Pagination.Item>
                      <Pagination.Next
                        aria-label="下一页"
                        isDisabled={activeAutomationPage === automationPageCount}
                        onPress={() => setAutomationPage(activeAutomationPage + 1)}
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
        <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
          <Modal.Trigger aria-hidden="true" tabIndex={-1} className="hidden" />
          <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
            <Modal.Container placement="center" size="lg">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>
                    新建集成自动化
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="space-y-4">
                  <div className="grid gap-4">
                    <div className="grid gap-1.5">
                      <span>
                        表单
                      </span>
                      <Select
                        aria-label="表单"
                        selectedKey={createFormUuid}
                        onSelectionChange={(key) =>
                          updateCreateForm(String(key ?? ""))
                        }
                      >
                        <Select.Trigger>
                          <Select.Value>
                            {forms.find((form) => form.id === createFormUuid)
                              ?.name ?? "选择触发表单"}
                          </Select.Value>
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
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
                    </div>
                  </div>
                  <div className="grid w-full gap-1.5">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      自动化标题
                    </span>
                    <Input
                      aria-label="自动化标题"
                      fullWidth
                      className="w-full"
                      value={createAutomationName}
                      onChange={(event) =>
                        setCreateAutomationName(event.currentTarget.value)
                      }
                    />
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="ghost"
                    onClick={() => setCreateOpen(false)}
                  >
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
        </Modal>
      ) : null}

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}
      >
        <AlertDialog.Trigger
          aria-hidden="true"
          tabIndex={-1}
          className="hidden"
        />
        <AlertDialog.Backdrop className="theme-modal-backdrop">
          <AlertDialog.Container placement="center" size="md">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  删除集成自动化
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="">
                删除后，该自动化定义及其运行日志将一并删除，且不可恢复。
              </AlertDialog.Body>
              <AlertDialog.Footer className="">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteTarget(null)}
                >
                  取消
                </Button>
                <Button
                  onClick={() => void handleDeleteAutomation()}
                  isDisabled={busyAutomationId === deleteTarget?.id}
                >
                  删除
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      {logsTarget ? (
        <Modal
          isOpen={logsTarget !== null}
          onOpenChange={(open) => !open && setLogsTarget(null)}
        >
          <Modal.Trigger aria-hidden="true" tabIndex={-1} className="hidden" />
          <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
            <Modal.Container placement="center" size="cover">
              <Modal.Dialog className="theme-menu-surface w-[min(980px,94vw)] rounded-xl shadow-[var(--shadow-dialog)]">
                <Modal.Header className="border-b border-[var(--color-border)]">
                  <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                    运行日志
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="max-h-[72vh] space-y-4 overflow-auto px-5 py-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="text-sm text-[var(--color-text-secondary)]">
                      {logsTarget.name} · 最近执行记录
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <LogFilterTab
                        active={logsFilter === "all"}
                        label={`全部 ${runLogs.length}`}
                        onClick={() => setLogsFilter("all")}
                      />
                      <LogFilterTab
                        active={logsFilter === "failed"}
                        label={`失败 ${runLogs.filter((run) => run.status === "failed").length}`}
                        onClick={() => setLogsFilter("failed")}
                      />
                      <LogFilterTab
                        active={logsFilter === "success"}
                        label={`成功 ${runLogs.filter((run) => run.status === "success").length}`}
                        onClick={() => setLogsFilter("success")}
                      />
                      <LogFilterTab
                        active={logsFilter === "running"}
                        label={`运行中 ${runLogs.filter((run) => run.status === "running").length}`}
                        onClick={() => setLogsFilter("running")}
                      />
                    </div>
                  </div>
                  {logsLoading ? (
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] px-4 py-8 text-sm text-[var(--color-text-secondary)]">
                      正在加载运行日志...
                    </div>
                  ) : filteredRunLogs.length > 0 ? (
                    <div className="space-y-4">
                      {visibleRunLogs.map((run) => (
                        <div
                          key={run.id}
                          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
                            <div>
                              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                                运行 #{run.id}
                              </div>
                              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                                v{run.flowVersion} · {run.triggerEvent} ·{" "}
                                {formatDateTime(run.startedAt)}
                                {run.durationMs != null
                                  ? ` · ${formatDuration(run.durationMs)}`
                                  : ""}
                              </div>
                              {run.retrySource ||
                              run.retryRunUuid ||
                              run.retryNodeKey ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {run.retrySource ? (
                                    <RetrySourceBadge
                                      source={run.retrySource}
                                    />
                                  ) : null}
                                  {run.retryRunUuid ? (
                                    <span className="rounded-md bg-[var(--color-bg-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                                      来源运行 #{run.retryRunUuid}
                                    </span>
                                  ) : null}
                                  {run.retryNodeKey ? (
                                    <span className="rounded-md bg-[var(--color-warning-soft)] px-2 py-1 text-[11px] text-[var(--color-warning)]">
                                      断点节点 {run.retryNodeKey}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <RunStatusBadge status={run.status} />
                              <Button
                                variant="ghost"
                                className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-[var(--color-text-primary)]"
                                isDisabled={retryingKey === `run:${run.id}`}
                                onClick={() =>
                                  void handleRetryRun(logsTarget.id, run.id)
                                }
                              >
                                {retryingKey === `run:${run.id}`
                                  ? "重试中..."
                                  : "重头触发"}
                              </Button>
                            </div>
                          </div>
                          {run.errorMessage ? (
                            <div className="border-b border-[var(--color-border)] bg-[var(--color-danger-soft)] px-4 py-3 text-xs text-[var(--color-danger)]">
                              {run.errorMessage}
                            </div>
                          ) : null}
                          <div className="space-y-3 px-4 py-4">
                            <JsonPreviewCard
                              expanded={Boolean(
                                expandedJsonKeys[`run:${run.id}:trigger`],
                              )}
                              label="触发载荷"
                              value={run.triggerPayload}
                              onToggle={() =>
                                toggleJsonBlock(`run:${run.id}:trigger`)
                              }
                            />
                            {run.nodes.length > 0 ? (
                              sortRunNodes(run.nodes).map((node) => (
                                <div
                                  key={node.id}
                                  className={[
                                    "rounded-md border bg-[var(--color-bg-panel)] px-3 py-3",
                                    node.status === "failed"
                                      ? "border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)]"
                                      : "border-[var(--color-border)]",
                                  ].join(" ")}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                        {node.nodeLabel}
                                      </div>
                                      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                                        {node.nodeKind} ·{" "}
                                        {formatDateTime(node.startedAt)}
                                        {node.durationMs != null
                                          ? ` · ${formatDuration(node.durationMs)}`
                                          : ""}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <RunStatusBadge status={node.status} />
                                      {node.status === "failed" ? (
                                        <Button
                                          variant="ghost"
                                          className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 text-[var(--color-text-primary)]"
                                          isDisabled={
                                            retryingKey ===
                                            `node:${run.id}:${node.nodeKey}`
                                          }
                                          onClick={() =>
                                            void handleRetryNode(
                                              logsTarget.id,
                                              run.id,
                                              node.nodeKey,
                                            )
                                          }
                                        >
                                          {retryingKey ===
                                          `node:${run.id}:${node.nodeKey}`
                                            ? "重试中..."
                                            : "错误节点重试"}
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                  {node.errorMessage ? (
                                    <div className="mt-3 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
                                      {node.errorMessage}
                                    </div>
                                  ) : null}
                                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                    <JsonPreviewCard
                                      expanded={Boolean(
                                        expandedJsonKeys[
                                          `node:${node.id}:input`
                                        ],
                                      )}
                                      label="节点输入"
                                      value={node.input}
                                      onToggle={() =>
                                        toggleJsonBlock(`node:${node.id}:input`)
                                      }
                                    />
                                    <JsonPreviewCard
                                      expanded={Boolean(
                                        expandedJsonKeys[
                                          `node:${node.id}:output`
                                        ],
                                      )}
                                      label="节点输出"
                                      value={node.output ?? null}
                                      onToggle={() =>
                                        toggleJsonBlock(
                                          `node:${node.id}:output`,
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-sm text-[var(--color-text-secondary)]">
                                暂无节点执行明细
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {visibleRunCount < filteredRunLogs.length ? (
                        <div className="flex justify-center pt-1">
                          <Button
                            variant="ghost"
                            className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-4 text-[var(--color-text-primary)]"
                            onClick={() =>
                              setVisibleRunCount((current) => current + 10)
                            }
                          >
                            加载更多
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                      {runLogs.length > 0
                        ? "当前筛选条件下暂无运行日志"
                        : "暂无运行日志"}
                    </div>
                  )}
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
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
      <span className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-base font-semibold ${toneClassName}`}>{value}</span>
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
  const status = statusMeta[flow.status];

  return (
    <Table.Row className="align-middle">
      <Table.Cell className="min-w-[260px]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
            <FormIcon />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-medium text-[var(--color-text-primary)]">
                {flow.name}
              </div>
              <span
                className={
                  flow.flowType === "process"
                    ? "shrink-0 rounded bg-[var(--color-success-soft)] px-1.5 py-0.5 text-[11px] text-[var(--color-success)]"
                    : "shrink-0 rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
                }
              >
                {flow.flowType === "process" ? "流程类型" : "触发类型"}
              </span>
            </div>
          </div>
        </div>
      </Table.Cell>
      <Table.Cell>
        <span
          className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium ${status.className}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />
          {status.label}
        </span>
      </Table.Cell>
      <Table.Cell className="text-[var(--color-text-primary)]">{formName}</Table.Cell>
      <Table.Cell className="text-[var(--color-text-primary)]">
        {flow.triggerLabel}
      </Table.Cell>
      <Table.Cell className="text-[var(--color-text-secondary)]">
        {flow.nodesCount}
      </Table.Cell>
      <Table.Cell className="text-[var(--color-text-secondary)]">
        {flow.updatedBy}
      </Table.Cell>
      <Table.Cell className="text-[var(--color-text-secondary)]">
        {formatDateTime(flow.updatedAt)}
      </Table.Cell>
      <Table.Cell className="text-right">
        <Dropdown>
          <Tooltip>
            <Tooltip.Trigger>
              <Dropdown.Trigger
                aria-label={`${flow.name} 更多操作`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-soft)]"
              >
                <MoreIcon />
              </Dropdown.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Content>更多操作</Tooltip.Content>
          </Tooltip>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label={`${flow.name} 操作菜单`}
              className="min-w-[150px]"
            >
              <Dropdown.Item
                id="toggle"
                isDisabled={isBusy}
                onAction={onToggle}
              >
                {flow.status === "enabled" ? "停止" : "启动"}
              </Dropdown.Item>
              <Dropdown.Item id="edit" onAction={onEdit}>
                编辑编排
              </Dropdown.Item>
              <Dropdown.Item id="logs" onAction={onLogs}>
                运行日志
              </Dropdown.Item>
              <Dropdown.Item
                id="delete"
                isDisabled={isBusy}
                className="text-[var(--color-danger)]"
                onAction={onDelete}
              >
                删除
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
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
        {hasKeyword
          ? "调整搜索条件后再查看。"
          : "暂无自动化"}
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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RunStatusBadge({ status }: { status: string }) {
  const className =
    status === "success"
      ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
      : status === "failed"
        ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
        : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]";

  const label =
    status === "success" ? "成功" : status === "failed" ? "失败" : "运行中";

  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function RetrySourceBadge({ source }: { source: string }) {
  const label =
    source === "node"
      ? "节点断点重试"
      : source === "flow"
        ? "整流重试"
        : source;
  const className =
    source === "node"
      ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
      : "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";

  return (
    <span
      className={`rounded-md px-2 py-1 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function LogFilterTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className={[
        "h-8 rounded-md px-3 text-xs",
        active
          ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          : "border border-[var(--color-border)] bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)]",
      ].join(" ")}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function JsonPreviewCard({
  expanded,
  label,
  value,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  value: unknown;
  onToggle: () => void;
}) {
  const hasValue = value !== null && value !== undefined;
  const preview = hasValue ? formatJsonPreview(value) : "暂无数据";

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-xs font-medium text-[var(--color-text-secondary)]">
          {label}
        </div>
        <Button
          variant="ghost"
          className="h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2 text-xs text-[var(--color-text-primary)]"
          onClick={onToggle}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      </div>
      <div className="px-3 py-3">
        {expanded ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-[var(--color-text-primary)]">
            {JSON.stringify(value ?? null, null, 2)}
          </pre>
        ) : (
          <div className="line-clamp-3 text-xs leading-6 text-[var(--color-text-secondary)]">
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}

function formatJsonPreview(value: unknown) {
  if (value === null || value === undefined) {
    return "暂无数据";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function formatDuration(value: number) {
  if (value < 1000) {
    return `${value}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${(value / 60_000).toFixed(2)}m`;
}
