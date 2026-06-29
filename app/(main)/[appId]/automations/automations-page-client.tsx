"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Input, ListBox, Select, toast } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import {
  createAutomationFlow,
  deleteAutomationFlow,
  listAutomationFlows,
  listForms,
  updateAutomationFlow,
  type AutomationFlow,
  type AutomationFlowList,
  type FormSummary,
} from "../../../lib/api-client";
import { AddIcon, FormIcon, ListIcon, MoreIcon } from "../../../components/app-icons";
import {
  statusMeta,
  triggerEvents,
  type AutomationStatus,
  type TriggerEvent,
} from "./automation-shared";

type AutomationsPageClientProps = {
  appId: string;
};

type AutomationRunNode = {
  id: string;
  nodeKey: string;
  nodeKind: string;
  nodeLabel: string;
  status: string;
  input: Record<string, unknown> | unknown[] | null;
  output?: Record<string, unknown> | unknown[] | string | number | boolean | null;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
};

type AutomationRun = {
  id: string;
  flowVersion: number;
  triggerEvent: string;
  triggerPayload: Record<string, unknown> | null;
  status: string;
  retrySource?: string | null;
  retryRunUuid?: string | null;
  retryNodeKey?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  nodes: AutomationRunNode[];
};

type RunLogFilter = "all" | "failed" | "success" | "running";

const emptyAutomationList: AutomationFlowList = {
  items: [],
  total: 0,
  enabled: 0,
  paused: 0,
  draft: 0,
};

export function AutomationsPageClient({ appId }: AutomationsPageClientProps) {
  const router = useRouter();
  const [automationList, setAutomationList] =
    useState<AutomationFlowList>(emptyAutomationList);
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAutomationId, setBusyAutomationId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationFlow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createFormUuid, setCreateFormUuid] = useState("");
  const [createTriggerEvent, setCreateTriggerEvent] =
    useState<TriggerEvent>("after_create");
  const [logsTarget, setLogsTarget] = useState<AutomationFlow | null>(null);
  const [runLogs, setRunLogs] = useState<AutomationRun[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsFilter, setLogsFilter] = useState<RunLogFilter>("all");
  const [visibleRunCount, setVisibleRunCount] = useState(10);
  const [expandedJsonKeys, setExpandedJsonKeys] = useState<Record<string, boolean>>({});
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadData = useCallback(async () => {
    setErrorMessage("");

    startTransition(async () => {
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

        setAutomationList(flowsResult.data.data);
        setForms(formsResult.data.data);
      } catch {
        setErrorMessage("集成自动化数据加载失败，请确认后端服务和数据库已启动。");
      }
    });
  }, [appId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadData]);

  const formNameByUuid = useMemo(() => {
    return new Map(forms.map((form) => [form.id, form.name]));
  }, [forms]);

  const filteredAutomations = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (!normalizedKeyword) {
      return automationList.items;
    }

    return automationList.items.filter((flow) => {
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
  }, [automationList.items, formNameByUuid, keyword]);

  function openCreateModal() {
    setCreateName("");
    setCreateDescription("");
    setCreateFormUuid(forms[0]?.id ?? "");
    setCreateTriggerEvent("after_create");
    setCreateOpen(true);
  }

  async function handleCreateAutomation() {
    if (!createFormUuid) {
      setErrorMessage("请先创建表单，再配置集成自动化。");
      return;
    }

    setErrorMessage("");

    startTransition(async () => {
      try {
        const { data, error } = await createAutomationFlow({
          path: { appId },
          body: {
            name: createName.trim() || undefined,
            description: createDescription.trim() || undefined,
            triggerFormUuid: createFormUuid,
            triggerEvent: createTriggerEvent,
          },
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("create automation flow failed");
        }

        setAutomationList((current) => ({
          ...current,
          items: [data.data, ...current.items],
          total: current.total + 1,
          draft: current.draft + 1,
        }));
        setCreateOpen(false);
        toast.success("集成自动化已创建");
        router.push(`/${appId}/automations/${data.data.id}`);
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

      setAutomationList((current) => rebuildAutomationList(current, data.data));
      toast.success(nextStatus === "enabled" ? "自动化已启用" : "自动化已停用");
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

      if (error || !data || data.code !== 0) {
        throw new Error("delete automation flow failed");
      }

      setAutomationList((current) => removeAutomationFromList(current, deleteTarget));
      setDeleteTarget(null);
      toast.success("集成自动化已删除");
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
      const response = await fetch(`/api/automations/${flow.id}/runs`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        code: number;
        data: AutomationRun[] | null;
      };
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error("load automation runs failed");
      }
      setRunLogs(payload.data);
    } catch {
      setRunLogs([]);
      toast.danger("运行日志加载失败");
    } finally {
      setLogsLoading(false);
    }
  }

  async function handleRetryRun(flowId: string, runId: string) {
    setRetryingKey(`run:${runId}`);
    try {
      const response = await fetch(`/api/automations/${flowId}/runs/${runId}/retry`, {
        method: "POST",
      });
      const payload = await response.json() as { code: number };
      if (!response.ok || payload.code !== 0) {
        throw new Error("retry run failed");
      }
      toast.success("已重新触发自动化");
      if (logsTarget?.id === flowId) {
        await openRunLogs(logsTarget);
      }
    } catch {
      toast.danger("重新触发失败");
    } finally {
      setRetryingKey(null);
    }
  }

  async function handleRetryNode(flowId: string, runId: string, nodeKey: string) {
    setRetryingKey(`node:${runId}:${nodeKey}`);
    try {
      const response = await fetch(
        `/api/automations/${flowId}/runs/${runId}/nodes/${encodeURIComponent(nodeKey)}/retry`,
        {
          method: "POST",
        },
      );
      const payload = await response.json() as { code: number };
      if (!response.ok || payload.code !== 0) {
        throw new Error("retry node failed");
      }
      toast.success("已发起错误节点重试");
      if (logsTarget?.id === flowId) {
        await openRunLogs(logsTarget);
      }
    } catch {
      toast.danger("节点重试失败");
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

  function sortRunNodes(nodes: AutomationRunNode[]) {
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
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 py-5 text-[#14213d] lg:px-6">
      <section className="flex flex-col gap-4 border-b border-[#dfe8f5] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-lg bg-[#eef5ff] px-3 py-1 text-xs font-medium text-[#2f6bff]">
            <ListIcon />
            集成自动化
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal text-[#14213d]">
            自动化流程
          </h1>
          <p className="mt-2 max-w-[760px] text-sm leading-6 text-[#60718a]">
            基于表单记录创建、编辑、删除事件触发后端业务处理，后续将在这里进入触发器和节点编排。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
            onClick={() => void loadData()}
            isDisabled={isPending}
          >
            刷新
          </Button>
          <Button
            className="h-10 rounded-lg bg-[#2f6bff] px-4 text-white"
            onClick={openCreateModal}
            isDisabled={forms.length === 0}
          >
            <AddIcon />
            新建自动化
          </Button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="全部" value={automationList.total} />
        <Metric label="已启用" value={automationList.enabled} tone="green" />
        <Metric label="草稿" value={automationList.draft} tone="amber" />
        <Metric label="已停用" value={automationList.paused} />
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-[#ffd6df] bg-[#fff4f6] px-4 py-3 text-sm text-[#b42345]">
          {errorMessage}
        </div>
      ) : null}

      {forms.length === 0 ? (
        <div className="rounded-lg border border-[#dfe8f5] bg-white px-5 py-4 text-sm leading-6 text-[#60718a]">
          当前应用还没有可作为触发目标的表单。请先创建并设计表单，再创建集成自动化。
        </div>
      ) : null}

      <section className="min-w-0 overflow-hidden rounded-lg border border-[#dfe8f5] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#edf2f7] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#14213d]">规则列表</h2>
            <p className="mt-1 text-xs text-[#7587a3]">
              当前只管理自动化定义，执行器和日志会在下一阶段接入。
            </p>
          </div>
          <Input
            aria-label="搜索自动化"
            className="w-full lg:w-[320px]"
            placeholder="搜索名称、触发表单或事件"
            value={keyword}
            onChange={(event) => setKeyword(event.currentTarget.value)}
          />
        </div>

        {filteredAutomations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-[#f7faff] text-xs font-medium text-[#60718a]">
                <tr>
                  <th className="px-4 py-3">自动化名称</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">触发表单</th>
                  <th className="px-4 py-3">触发事件</th>
                  <th className="px-4 py-3">节点</th>
                  <th className="px-4 py-3">更新人</th>
                  <th className="px-4 py-3">更新时间</th>
                  <th className="w-[72px] px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAutomations.map((flow) => (
                  <AutomationRow
                    key={flow.id}
                    flow={flow}
                    formName={getTriggerFormName(flow, formNameByUuid)}
                    isBusy={busyAutomationId === flow.id}
                    onEdit={() => router.push(`/${appId}/automations/${flow.id}`)}
                    onLogs={() => void openRunLogs(flow)}
                    onToggle={() => void handleToggleAutomation(flow)}
                    onDelete={() => setDeleteTarget(flow)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState hasKeyword={keyword.trim().length > 0} />
        )}
      </section>

      {createOpen ? (
        <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
          <Modal.Backdrop className="bg-[#14213d]/20" isDismissable>
            <Modal.Container placement="center" size="lg">
              <Modal.Dialog className="rounded-lg bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
                <Modal.Header className="border-b border-[#eef2f7] px-5 py-4">
                  <Modal.Heading className="text-lg font-semibold text-[#14213d]">
                    新建集成自动化
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="space-y-4 px-5 py-4">
                  <Input
                    aria-label="自动化名称"
                    placeholder="自动化名称"
                    value={createName}
                    onChange={(event) => setCreateName(event.currentTarget.value)}
                  />
                  <Input
                    aria-label="自动化说明"
                    placeholder="说明，可选"
                    value={createDescription}
                    onChange={(event) => setCreateDescription(event.currentTarget.value)}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Select
                      selectedKey={createFormUuid}
                      onSelectionChange={(key) => setCreateFormUuid(String(key ?? ""))}
                    >
                      <Select.Trigger>
                        <Select.Value>
                          {forms.find((form) => form.id === createFormUuid)?.name ??
                            "选择触发表单"}
                        </Select.Value>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {forms.map((form) => (
                            <ListBox.Item key={form.id} id={form.id} textValue={form.name}>
                              {form.name}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

                    <Select
                      selectedKey={createTriggerEvent}
                      onSelectionChange={(key) =>
                        setCreateTriggerEvent(String(key ?? "after_create") as TriggerEvent)
                      }
                    >
                      <Select.Trigger>
                        <Select.Value>
                          {triggerEvents.find((event) => event.id === createTriggerEvent)
                            ?.label ?? "创建成功后"}
                        </Select.Value>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {triggerEvents.map((event) => (
                            <ListBox.Item key={event.id} id={event.id} textValue={event.label}>
                              {event.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-3 border-t border-[#eef2f7] px-5 py-3">
                  <Button
                    variant="ghost"
                    className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
                    onClick={() => setCreateOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="h-10 rounded-lg bg-[#2f6bff] px-4 text-white"
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
        <AlertDialog.Backdrop className="bg-[#14213d]/20" />
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog className="rounded-lg bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <AlertDialog.Header className="border-b border-[#eef2f7] px-5 py-4">
              <AlertDialog.Heading className="text-lg font-semibold text-[#14213d]">
                删除集成自动化
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[#5f718e]">
              删除后，该自动化定义将不再出现在规则列表中。当前版本尚未接入执行日志，所以没有运行记录需要保留。
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[#eef2f7] px-5 py-3">
              <Button
                variant="ghost"
                onClick={() => setDeleteTarget(null)}
                className="h-10 rounded-lg border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
              >
                取消
              </Button>
              <Button
                onClick={() => void handleDeleteAutomation()}
                isDisabled={busyAutomationId === deleteTarget?.id}
                className="h-10 rounded-lg bg-[#c73655] px-4 text-white"
              >
                删除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog>

      {logsTarget ? (
        <Modal isOpen={logsTarget !== null} onOpenChange={(open) => !open && setLogsTarget(null)}>
          <Modal.Backdrop className="bg-[#14213d]/20" isDismissable>
            <Modal.Container placement="center" size="cover">
              <Modal.Dialog className="w-[min(980px,94vw)] rounded-lg bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
                <Modal.Header className="border-b border-[#eef2f7] px-5 py-4">
                  <Modal.Heading className="text-lg font-semibold text-[#14213d]">
                    运行日志
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="max-h-[72vh] space-y-4 overflow-auto px-5 py-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="text-sm text-[#60718a]">
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
                    <div className="rounded-lg border border-[#dfe8f5] bg-[#f9fbff] px-4 py-8 text-sm text-[#60718a]">
                      正在加载运行日志...
                    </div>
                  ) : filteredRunLogs.length > 0 ? (
                    <div className="space-y-4">
                      {visibleRunLogs.map((run) => (
                        <div key={run.id} className="rounded-lg border border-[#dfe8f5] bg-[#fbfdff]">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf2f7] px-4 py-3">
                            <div>
                              <div className="text-sm font-semibold text-[#14213d]">
                                运行 #{run.id}
                              </div>
                              <div className="mt-1 text-xs text-[#7587a3]">
                                v{run.flowVersion} · {run.triggerEvent} · {formatDateTime(run.startedAt)}
                                {run.durationMs != null ? ` · ${formatDuration(run.durationMs)}` : ""}
                              </div>
                              {(run.retrySource || run.retryRunUuid || run.retryNodeKey) ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {run.retrySource ? (
                                    <RetrySourceBadge source={run.retrySource} />
                                  ) : null}
                                  {run.retryRunUuid ? (
                                    <span className="rounded-md bg-[#f5f7fb] px-2 py-1 text-[11px] text-[#60718a]">
                                      来源运行 #{run.retryRunUuid}
                                    </span>
                                  ) : null}
                                  {run.retryNodeKey ? (
                                    <span className="rounded-md bg-[#fff7ed] px-2 py-1 text-[11px] text-[#b45309]">
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
                                className="h-8 rounded-md border border-[#d7e2f1] bg-white px-3 text-[#263a5c]"
                                isDisabled={retryingKey === `run:${run.id}`}
                                onClick={() => void handleRetryRun(logsTarget.id, run.id)}
                              >
                                {retryingKey === `run:${run.id}` ? "重试中..." : "重头触发"}
                              </Button>
                            </div>
                          </div>
                          {run.errorMessage ? (
                            <div className="border-b border-[#edf2f7] bg-[#fff4f6] px-4 py-3 text-xs text-[#b42345]">
                              {run.errorMessage}
                            </div>
                          ) : null}
                          <div className="space-y-3 px-4 py-4">
                            <JsonPreviewCard
                              expanded={Boolean(expandedJsonKeys[`run:${run.id}:trigger`])}
                              label="触发载荷"
                              value={run.triggerPayload}
                              onToggle={() => toggleJsonBlock(`run:${run.id}:trigger`)}
                            />
                            {run.nodes.length > 0 ? sortRunNodes(run.nodes).map((node) => (
                              <div
                                key={node.id}
                                className={[
                                  "rounded-md border bg-white px-3 py-3",
                                  node.status === "failed"
                                    ? "border-[#ffd6df] bg-[#fffafb]"
                                    : "border-[#e7edf7]",
                                ].join(" ")}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-[#14213d]">
                                      {node.nodeLabel}
                                    </div>
                                    <div className="mt-1 text-xs text-[#7587a3]">
                                      {node.nodeKind} · {formatDateTime(node.startedAt)}
                                      {node.durationMs != null ? ` · ${formatDuration(node.durationMs)}` : ""}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <RunStatusBadge status={node.status} />
                                    {node.status === "failed" ? (
                                      <Button
                                        variant="ghost"
                                        className="h-8 rounded-md border border-[#d7e2f1] bg-white px-3 text-[#263a5c]"
                                        isDisabled={retryingKey === `node:${run.id}:${node.nodeKey}`}
                                        onClick={() => void handleRetryNode(logsTarget.id, run.id, node.nodeKey)}
                                      >
                                        {retryingKey === `node:${run.id}:${node.nodeKey}` ? "重试中..." : "错误节点重试"}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                                {node.errorMessage ? (
                                  <div className="mt-3 rounded-md border border-[#ffd6df] bg-[#fff4f6] px-3 py-2 text-xs text-[#b42345]">
                                    {node.errorMessage}
                                  </div>
                                ) : null}
                                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                  <JsonPreviewCard
                                    expanded={Boolean(expandedJsonKeys[`node:${node.id}:input`])}
                                    label="节点输入"
                                    value={node.input}
                                    onToggle={() => toggleJsonBlock(`node:${node.id}:input`)}
                                  />
                                  <JsonPreviewCard
                                    expanded={Boolean(expandedJsonKeys[`node:${node.id}:output`])}
                                    label="节点输出"
                                    value={node.output ?? null}
                                    onToggle={() => toggleJsonBlock(`node:${node.id}:output`)}
                                  />
                                </div>
                              </div>
                            )) : (
                              <div className="text-sm text-[#7587a3]">暂无节点执行明细</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {visibleRunCount < filteredRunLogs.length ? (
                        <div className="flex justify-center pt-1">
                          <Button
                            variant="ghost"
                            className="h-9 rounded-md border border-[#d7e2f1] bg-white px-4 text-[#263a5c]"
                            onClick={() => setVisibleRunCount((current) => current + 10)}
                          >
                            加载更多
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[#dfe8f5] px-4 py-10 text-center text-sm text-[#60718a]">
                      {runLogs.length > 0 ? "当前筛选条件下暂无运行日志" : "暂无运行日志"}
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
      ? "text-[#16864b]"
      : tone === "amber"
        ? "text-[#a36a08]"
        : "text-[#14213d]";

  return (
    <div className="rounded-lg border border-[#dfe8f5] bg-white px-4 py-3">
      <div className="text-xs text-[#7587a3]">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClassName}`}>{value}</div>
    </div>
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
    <tr className="border-t border-[#edf2f7] align-top hover:bg-[#fbfdff]">
      <td className="px-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef5ff] text-[#2f6bff]">
            <FormIcon />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-[#14213d]">{flow.name}</div>
            <div className="mt-1 max-w-[300px] truncate text-xs text-[#7587a3]">
              {flow.description || flow.id}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium ${status.className}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />
          {status.label}
        </span>
      </td>
      <td className="px-4 py-4 text-[#263a5c]">{formName}</td>
      <td className="px-4 py-4 text-[#263a5c]">{flow.triggerLabel}</td>
      <td className="px-4 py-4 text-[#60718a]">{flow.nodesCount}</td>
      <td className="px-4 py-4 text-[#60718a]">{flow.updatedBy}</td>
      <td className="px-4 py-4 text-[#60718a]">{formatDateTime(flow.updatedAt)}</td>
      <td className="px-4 py-4 text-right">
        <Dropdown>
          <Dropdown.Trigger>
            <span
              aria-label={`${flow.name} 更多操作`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#7587a3] hover:bg-[#eef5ff]"
            >
              <MoreIcon />
            </span>
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label={`${flow.name} 操作菜单`} className="min-w-[150px]">
              <Dropdown.Item id="toggle" isDisabled={isBusy} onAction={onToggle}>
                {flow.status === "enabled" ? "停用" : "启用"}
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
                className="text-[#c73655]"
                onAction={onDelete}
              >
                删除
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </td>
    </tr>
  );
}

function EmptyState({ hasKeyword }: { hasKeyword: boolean }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center px-5 py-10 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[#eef5ff] text-[#2f6bff]">
        <ListIcon />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[#14213d]">
        {hasKeyword ? "没有匹配的自动化" : "还没有集成自动化"}
      </h3>
      <p className="mt-2 max-w-[420px] text-sm leading-6 text-[#60718a]">
        {hasKeyword
          ? "调整搜索条件后再查看。"
          : "新建后会先进入草稿状态，后续可以继续配置触发器条件和执行节点。"}
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
  return buildAutomationList(current.items.filter((flow) => flow.id !== removedFlow.id));
}

function buildAutomationList(items: AutomationFlow[]): AutomationFlowList {
  return {
    items,
    total: items.length,
    enabled: items.filter((flow) => flow.status === "enabled").length,
    paused: items.filter((flow) => flow.status === "paused").length,
    draft: items.filter((flow) => flow.status === "draft").length,
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
      ? "bg-[#ecfdf3] text-[#16864b]"
      : status === "failed"
        ? "bg-[#fff4f6] text-[#c73655]"
        : "bg-[#f5f7fb] text-[#60718a]";

  const label =
    status === "success" ? "成功" : status === "failed" ? "失败" : "运行中";

  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function RetrySourceBadge({ source }: { source: string }) {
  const label =
    source === "node" ? "节点断点重试" : source === "flow" ? "整流重试" : source;
  const className =
    source === "node"
      ? "bg-[#fff7ed] text-[#b45309]"
      : "bg-[#eef5ff] text-[#2f6bff]";

  return (
    <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${className}`}>
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
          ? "bg-[#edf4ff] text-[#2f6bff]"
          : "border border-[#d7e2f1] bg-white text-[#60718a]",
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
    <div className="rounded-md border border-[#e7edf7] bg-[#f9fbff]">
      <div className="flex items-center justify-between gap-3 border-b border-[#edf2f7] px-3 py-2">
        <div className="text-xs font-medium text-[#4b5f7c]">{label}</div>
        <Button
          variant="ghost"
          className="h-7 rounded-md border border-[#d7e2f1] bg-white px-2 text-xs text-[#263a5c]"
          onClick={onToggle}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      </div>
      <div className="px-3 py-3">
        {expanded ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6 text-[#263a5c]">
            {JSON.stringify(value ?? null, null, 2)}
          </pre>
        ) : (
          <div className="line-clamp-3 text-xs leading-6 text-[#60718a]">{preview}</div>
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
