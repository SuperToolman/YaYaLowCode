"use client";
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
  toast,
} from "@heroui/react";
import {
  approveWorkflowTask,
  rejectWorkflowTask,
} from "@/features/workflow/api";
import { formatDateTime } from "./form-record-utils";
import type { ApiEnvelope } from "@/app/lib/api-request";
import styles from "./SystemPageView.module.css";

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
    kind: "approve" | "reject" | "complete";
  } | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const load = useCallback(
    async (next: Scope) => {
      setLoading(true);
      setError("");
      try {
        const search = new URLSearchParams({ scope: next });
        if (filter) search.set("appId", filter);
        const response = await fetch(`/api/workflow/tasks?${search}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as ApiEnvelope<{ items?: Item[] }>;
        if (!response.ok || body.code !== 0)
          throw new Error(body.message || "加载任务失败");
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
      return toast.danger("请填写拒绝意见");
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
      if (
        result.error ||
        (result.data as ApiEnvelope<unknown> | undefined)?.code !== 0
      )
        throw new Error(
          (result.data as ApiEnvelope<unknown> | undefined)?.message ||
            "任务处理失败",
        );
      toast.success("任务已处理");
      setAction(null);
      await load(scope);
    } catch (cause) {
      toast.danger("任务处理失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{pageTitle}</h1>
            <p className={styles.subtitle}>
              查看所有应用中的流程任务与审批记录。
            </p>
          </div>
          <Input
            aria-label="搜索任务"
            className={styles.search}
            placeholder="搜索任务"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <nav className={styles.tabs}>
            <Tabs
              selectedKey={scope}
              onSelectionChange={(key) => setScope(String(key) as Scope)}
              aria-label="任务分类"
            >
              <Tabs.List>
                {tabs.map((tab) => (
                  <Tabs.Tab key={tab.id} id={tab.id}>
                    {tab.label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          </nav>
        </header>
        <div className={styles.tableArea}>
          <Table className={styles.table}>
            <Table.ScrollContainer className={styles.scroll}>
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
                    <EmptyState className={styles.empty}>
                      {loading ? "正在加载任务…" : error || "暂无相关流程任务"}
                    </EmptyState>
                  )}
                >
                  <Table.Collection items={rows}>
                    {(row) => (
                      <Table.Row key={`${row.appId}-${row.id}`} id={row.id}>
                        <Table.Cell>
                          <Button
                            className={styles.taskButton}
                            onPress={() =>
                              router.push(
                                `/${row.appId || appId}/${row.formUuid}?record=${encodeURIComponent(row.recordUuid)}`,
                              )
                            }
                          >
                            <span>
                              <span className={styles.taskName}>
                                {row.formName}
                              </span>
                              <span className={styles.taskMeta}>
                                {row.flowName} · {row.nodeLabel || "流程处理中"}
                              </span>
                            </span>
                          </Button>
                        </Table.Cell>
                        <Table.Cell>
                          <span className={styles.appId}>{row.appId}</span>
                        </Table.Cell>
                        <Table.Cell>{row.submitter}</Table.Cell>
                        <Table.Cell>
                          <span className={styles.muted}>
                            {formatDateTime(
                              row.completedAt || row.updatedAt || row.createdAt,
                            )}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          {scope === "todo" &&
                          row.status === "pending" &&
                          row.taskType === "approval" ? (
                            <div className={styles.rowActions}>
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
      <Modal
        isOpen={action !== null}
        onOpenChange={(open) => !open && !submitting && setAction(null)}
      >
        <Modal.Backdrop>
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
      </Modal>
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
