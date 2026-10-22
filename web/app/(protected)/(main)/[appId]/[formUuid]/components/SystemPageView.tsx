"use client";
import { assertApiResult } from "@lib/api-request";

import { notifyRequestError } from "@lib/notify";
import { notify } from "@lib/notify";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Chip,
  EmptyState,
  Input,
  Modal,
  Table,
  Tabs,
  TextArea,
} from "@heroui/react";
import {
  approveWorkflowTask,
  listWorkflowTasks,
  rejectWorkflowTask,
} from "@/features/workflow/api";
import { formatDateTime } from "../form-record-utils";
import type { ApiEnvelope } from "@/app/lib/api-request";

type Scope = "todo" | "processed" | "created" | "copied";
type Item = {
  id: string;
  appId: string;
  taskType: string;
  status: string;
  formUuid: string;
  formName: string;
  recordUuid: string;
  instanceId: string;
  flowName: string;
  nodeLabel: string | null;
  submitter: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
const tabs: Array<{ id: Scope; label: string }> = [
  { id: "todo", label: "待我处理" },
  { id: "processed", label: "我处理的" },
  { id: "created", label: "我创建的" },
  { id: "copied", label: "抄送我的" },
];

export function SystemPageView({
  appId,
  pageSlug,
  pageTitle,
}: {
  appId: string;
  pageSlug: string;
  pageTitle: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const filter = params.get("appId")?.trim() ?? "";
  const [scope, setScope] = useState<Scope>(
    tabs.some((tab) => tab.id === pageSlug) ? (pageSlug as Scope) : "todo",
  );
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<{
    item: Item;
    kind: "approve" | "reject";
  } | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const load = useCallback(
    async (next: Scope) => {
      setLoading(true);
      setError("");
      try {
        const result = await listWorkflowTasks({ query: { scope: next, appId: filter || undefined }, responseStyle: "fields" });
        assertApiResult(result);
        const body = result.data as ApiEnvelope<{ items?: Item[] }>;
        setItems(body.data?.items ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "加载任务失败");
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(scope), 0);
    return () => window.clearTimeout(timer);
  }, [load, scope]);
  const rows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        !text ||
        [
          item.formName,
          item.flowName,
          item.nodeLabel,
          item.submitter,
          item.instanceId,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(text),
    );
  }, [items, query]);
  async function submitAction() {
    if (!action) return;
    if (action.kind === "reject" && !comment.trim())
      return notify.error("请填写拒绝意见");
    setSubmitting(true);
    try {
      const request = {
        path: { taskUuid: action.item.id },
        body: { comment: comment.trim() || undefined },
        responseStyle: "fields" as const,
      };
      const result = await (action.kind === "reject"
        ? rejectWorkflowTask(request)
        : approveWorkflowTask(request));
      assertApiResult(result);
      notify.success("任务已处理");
      setAction(null);
      await load(scope);
    } catch (cause) {
      notifyRequestError(cause, "任务处理失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 w-full flex-col gap-4 py-6">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-4 min-[901px]:grid-cols-[minmax(0,1fr)_minmax(14rem,24rem)_minmax(0,1fr)]">
          <div>
            <h1 className="text-xl font-semibold">{pageTitle}</h1>
            <p className="mt-1 text-sm text-muted">
              查看所有应用中的流程任务与审批记录。
            </p>
          </div>
          <Input
            aria-label="搜索任务"
            className="col-span-full row-start-2 w-full min-[901px]:col-span-1 min-[901px]:col-start-2 min-[901px]:row-start-1"
            placeholder="搜索任务"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <nav className="col-start-2 row-start-1 max-w-full justify-self-end overflow-x-auto min-[901px]:col-start-3">
            <Tabs
              selectedKey={scope}
              onSelectionChange={(key) => setScope(String(key) as Scope)}
              aria-label="任务分类"
            >
              <Tabs.ListContainer>
                <Tabs.List>
                  {tabs.map((tab) => (
                    <Tabs.Tab key={tab.id} id={tab.id}>
                      {tab.label}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </nav>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Table className="h-full min-h-0 min-w-[38.75rem] flex-1">
            <Table.ScrollContainer className="h-full overflow-auto">
              <Table.Content aria-label="任务列表">
                <Table.Header>
                  <Table.Column id="task" isRowHeader>
                    任务
                  </Table.Column>
                  <Table.Column id="app">应用</Table.Column>
                  <Table.Column id="submitter">发起人</Table.Column>
                  <Table.Column id="updated">更新时间</Table.Column>
                  <Table.Column id="actions">操作</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <EmptyState className="flex min-h-full items-center justify-center">
                      {loading ? "正在加载任务…" : error || "暂无相关流程任务"}
                    </EmptyState>
                  )}
                >
                  <Table.Collection items={rows}>
                    {(row) => (
                      <Table.Row key={`${row.appId}-${row.id}`} id={row.id}>
                        <Table.Cell>
                          <Button
                            variant="ghost"
                            className="h-auto justify-start p-0 text-left"
                            onPress={() =>
                              router.push(
                                `/${row.appId || appId}/${row.formUuid}?record=${encodeURIComponent(row.recordUuid)}${scope === "todo" && row.taskType === "execution" ? `&task=${encodeURIComponent(row.id)}` : ""}`,
                              )
                            }
                          >
                            <span>
                              <span className="block max-w-88 truncate font-medium">
                                {row.formName}
                              </span>
                              <span className="mt-1 block max-w-88 truncate text-xs text-muted">
                                {row.flowName} · {row.nodeLabel || "流程处理中"}
                              </span>
                            </span>
                          </Button>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-muted">{row.appId}</span>
                        </Table.Cell>
                        <Table.Cell>{row.submitter}</Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-muted">
                            {formatDateTime(
                              row.completedAt || row.updatedAt || row.createdAt,
                            )}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          {scope === "todo" &&
                          row.status === "pending" &&
                          row.taskType === "approval" ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                onPress={() => {
                                  setComment("");
                                  setAction({ item: row, kind: "approve" });
                                }}
                              >
                                同意
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onPress={() => {
                                  setComment("");
                                  setAction({ item: row, kind: "reject" });
                                }}
                              >
                                拒绝
                              </Button>
                            </div>
                          ) : scope === "todo" && row.status === "pending" && row.taskType === "execution" ? (
                            <Button size="sm" onPress={() => router.push(`/${row.appId || appId}/${row.formUuid}?record=${encodeURIComponent(row.recordUuid)}&task=${encodeURIComponent(row.id)}`)}>
                              填写并完成
                            </Button>
                          ) : (
                            <Chip
                              size="sm"
                              color={
                                row.status === "pending" ? "warning" : "default"
                              }
                            >
                              {statusLabel(row.status)}
                            </Chip>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Table.Collection>
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </div>
      </div>
      <Modal.Backdrop
        isOpen={action !== null}
        onOpenChange={(open) => !open && !submitting && setAction(null)}
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>
                {action?.kind === "reject" ? "拒绝任务" : "同意任务"}
              </Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <TextArea
                aria-label="审批意见"
                value={comment}
                onChange={(event) => setComment(event.currentTarget.value)}
                placeholder="可填写审批意见"
              />
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={() => setAction(null)}>取消</Button>
              <Button
                isPending={submitting}
                isDisabled={
                  submitting || (action?.kind === "reject" && !comment.trim())
                }
                onPress={() => void submitAction()}
              >
                确认
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
function statusLabel(status: string) {
  return (
    (
      {
        pending: "待处理",
        approved: "已同意",
        rejected: "已拒绝",
        completed: "已完成",
        running: "进行中",
        failed: "失败",
      } as Record<string, string>
    )[status] ?? status
  );
}
