"use client";

import { useEffect, useState } from "react";
import { Button, Tabs, TextArea, toast } from "@heroui/react";
import { createWorkflowComment, getWorkflowRecordRuntime, listWorkflowComments } from "../../../lib/api-client";
import { formatDateTime } from "./form-record-utils";

type ApiEnvelope<T> = { code: number; data: T | null; message: string };
type WorkflowAction = { action: string; operator: string; comment: string | null; createdAt: string };
type WorkflowComment = { id: string; author: string; content: string; createdAt: string };
type FormRecord = { id: string; formUuid: string; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string };

export function DetailAuxiliaryPanel({
  activeTab,
  record,
  onTabChange,
}: {
  activeTab: "comments" | "history";
  record: FormRecord;
  onTabChange: (tab: "comments" | "history") => void;
}) {
  const [workflowActions, setWorkflowActions] = useState<WorkflowAction[]>([]);
  const [workflowHistoryLoading, setWorkflowHistoryLoading] = useState(false);
  const [comments, setComments] = useState<WorkflowComment[]>([]);
  const [commentContent, setCommentContent] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const hasUpdated = record.updatedAt !== record.createdAt;
  const recordChanges = [
    { id: "created", type: "创建", actor: record.createdBy, text: `${record.createdBy} 创建记录`, time: record.createdAt },
    ...(hasUpdated ? [{ id: "updated", type: "更新", actor: record.updatedBy, text: `${record.updatedBy} 更新记录`, time: record.updatedAt }] : []),
  ];
  const changes = [
    ...recordChanges,
    ...workflowActions.map((action, index) => ({
      id: `workflow-${index}-${action.createdAt}`,
      type: workflowActionLabel(action.action),
      actor: action.operator,
      text: `${action.operator} ${workflowActionLabel(action.action)}${action.comment ? `：${action.comment}` : ""}`,
      time: action.createdAt,
    })),
  ].sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setWorkflowHistoryLoading(true);
      void getWorkflowRecordRuntime({ path: { formUuid: record.formUuid, recordUuid: record.id }, signal: controller.signal, responseStyle: "fields" })
        .then(({ data, error }) => {
          const result = data as ApiEnvelope<{ actions?: WorkflowAction[] }> | undefined;
          if (error || result?.code !== 0) throw new Error(result?.message || "加载流程轨迹失败");
          setWorkflowActions(Array.isArray(result.data?.actions) ? result.data.actions : []);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== "AbortError") setWorkflowActions([]);
        })
        .finally(() => setWorkflowHistoryLoading(false));
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [record.formUuid, record.id]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void listWorkflowComments({ path: { formUuid: record.formUuid, recordUuid: record.id }, signal: controller.signal, responseStyle: "fields" })
        .then(({ data, error }) => {
          const result = data as ApiEnvelope<{ items?: WorkflowComment[] }> | undefined;
          if (error || result?.code !== 0) throw new Error(result?.message || "加载评论失败");
          setComments(Array.isArray(result.data?.items) ? result.data.items : []);
        }).catch(() => setComments([]));
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [record.formUuid, record.id]);

  async function postComment() {
    const content = commentContent.trim();
    if (!content) return;
    setPostingComment(true);
    try {
      const { data, error } = await createWorkflowComment({ path: { formUuid: record.formUuid, recordUuid: record.id }, body: { content }, responseStyle: "fields" });
      const result = data as ApiEnvelope<WorkflowComment> | undefined;
      if (error || result?.code !== 0 || !result.data) throw new Error(result?.message || "评论发布失败");
      const createdComment = result.data;
      setComments((current) => [...current, createdComment]);
      setCommentContent("");
    } catch (error) {
      toast.danger("评论发布失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally { setPostingComment(false); }
  }

  return (
    <section className="mt-8 border-t border-[var(--color-border)] pt-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">其它</h3>
      <Tabs
        variant="secondary"
        selectedKey={activeTab}
        onSelectionChange={(key) => onTabChange(key as "comments" | "history")}
        className="mt-4"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="详情辅助信息">
            <Tabs.Tab id="comments" className="px-4 py-2 text-sm">评论<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="history" className="px-4 py-2 text-sm">变更记录<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="comments" className="outline-none">
          <div className="max-w-2xl space-y-4 py-5">
          {comments.map((comment) => <div key={comment.id} className="border-b border-[var(--color-border)] pb-3"><div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium text-[var(--color-text-primary)]">{comment.author}</span><span className="text-xs text-[var(--color-text-secondary)]">{formatDateTime(comment.createdAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{comment.content}</p></div>)}
          <TextArea aria-label="评论" placeholder="请输入评论" value={commentContent} onChange={(event) => setCommentContent(event.currentTarget.value)} disabled={postingComment} />
          <div className="flex justify-end"><Button size="sm" isDisabled={postingComment || !commentContent.trim()} onPress={() => void postComment()}>{postingComment ? "发布中..." : "发表评论"}</Button></div>
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="history" className="outline-none">
          <ol className="space-y-4 py-5">
          {workflowHistoryLoading ? <li className="text-sm text-[var(--color-text-secondary)]">正在加载流程轨迹...</li> : null}
          {changes.map((change) => (
            <li key={change.id} className="grid grid-cols-[10px_minmax(0,1fr)] gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium text-[var(--color-text-primary)]">{change.text}</span>
                  <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">{change.type}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-text-secondary)]">变更人：{change.actor} · {formatDateTime(change.time)}</div>
              </div>
            </li>
          ))}
          </ol>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}

function workflowActionLabel(action: string) {
  return ({ submit: "提交流程", approve: "同意", reject: "拒绝" } as Record<string, string>)[action] ?? action;
}
