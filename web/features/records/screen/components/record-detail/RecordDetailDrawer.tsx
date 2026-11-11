"use client";

import { useState } from "react";
import { Button, Dropdown, Modal, TextArea } from "@heroui/react";
import { Drawer } from "@heroui/react/drawer";
import { useQuery } from "@tanstack/react-query";
import { ArrowChevronLeft, ArrowChevronRight, ArrowsExpand, Copy, Ellipsis, Xmark } from "@gravity-ui/icons";
import { RuntimeFormSurface } from "@/features/form-runtime/components";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import type { FormRecord } from "@/features/records/types";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { approveWorkflowTask, getWorkflowRecordRuntime, rejectWorkflowTask } from "@/shared/lib/http";
import { unwrapApiResult } from "@/shared/lib/api-request";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { RuntimeFormPanel } from "@/features/records/screen/components/RuntimeFormPanel";
import { DetailAuxiliaryPanel } from "@/features/records/screen/components/record-detail/RecordDetailAuxiliaryPanel";
import { DetailBuiltIn } from "@/features/records/screen/components/record-detail/DetailBuiltIn";

export type RecordDetailBuiltIns = {
  [key: string]: string | undefined;
  instanceTitle?: string;
  createdAt?: string;
  submitter?: string;
  submitterOrganization?: string;
  instanceId?: string;
};

export function RecordDetailDrawer({
  readOnly = false,
  isOpen,
  onOpenChange,
  formName,
  schema,
  record,
  urlParams,
  submitting = false,
  showAuxiliary = false,
  builtIns,
  previousDisabled = true,
  nextDisabled = true,
  onPrevious,
  onNext,
  onCopy,
  activeTab = "comments",
  onTabChange,
  isEditing = false,
  onEditingChange,
  onSubmit,
  onSubmitMode,
  canEdit = false,
  canDelete = false,
  isDeleting = false,
  onDelete,
  canComplete = false,
  isContentReady = true,
  loading = false,
  error = "",
  formType = "normal",
  onWorkflowAction,
  onCompleteExecutionTask,
  onWorkflowTaskHandled,
}: {
  readOnly?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  formName: string;
  schema: RuntimeFormSchema | null;
  record: FormRecord | null;
  urlParams: Record<string, string>;
  submitting?: boolean;
  showAuxiliary?: boolean;
  builtIns?: RecordDetailBuiltIns | null;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onCopy?: () => void;
  activeTab?: "comments" | "history";
  onTabChange?: (tab: "comments" | "history") => void;
  isEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSubmit?: (values: Record<string, unknown>) => Promise<void>;
  onSubmitMode?: (mode: "save" | "complete") => void;
  canEdit?: boolean;
  canDelete?: boolean;
  isDeleting?: boolean;
  onDelete?: () => void;
  canComplete?: boolean;
  isContentReady?: boolean;
  loading?: boolean;
  error?: string;
  formType?: "normal" | "workflow";
  onWorkflowAction?: (action: "reverse" | "withdraw") => Promise<boolean>;
  onCompleteExecutionTask?: (taskId: string, values: Record<string, unknown>) => Promise<boolean>;
  onWorkflowTaskHandled?: () => Promise<void>;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rejectTaskId, setRejectTaskId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const { user } = useAuth();
  const runtimeQuery = useQuery({
    queryKey: ["workflow-record-runtime", record?.formUuid, record?.id],
    enabled: isOpen && formType === "workflow" && Boolean(record),
    queryFn: async ({ signal }) => {
      const result = await getWorkflowRecordRuntime({
        path: { formUuid: record!.formUuid, recordUuid: record!.id },
        signal,
        responseStyle: "fields",
      });
      return unwrapApiResult(result, "加载流程任务失败");
    },
  });
  const runtimeData = runtimeQuery.data as {
    instance?: { status?: string } | null;
    tasks?: Array<{ id?: string; nodeKey?: string; taskType?: string; assignee?: string; status?: string }>;
  } | undefined;
  const activeTasks = (runtimeData?.tasks ?? []).filter((task) =>
    !readOnly && task.status === "pending",
  );
  const isSubmitter = !readOnly && Boolean(record?.createdByUserId && user?.id === record.createdByUserId);
  const currentApprovalTask = activeTasks.find((task) =>
    task.taskType === "approval" && task.assignee === user?.id,
  );
  const currentExecutionTask = activeTasks.find((task) =>
    task.taskType === "execution" && task.assignee === user?.id,
  );
  const approvalStatus = String(record?.data.workflowApprovalStatus ?? "");
  const isWorkflow = formType === "workflow";
  const canWorkflowEdit = isWorkflow
    ? approvalStatus === "saved" ? canEdit : approvalStatus === "reviewing" && Boolean(currentExecutionTask)
    : canEdit;
  const canWorkflowDelete = isWorkflow ? approvalStatus === "saved" && canDelete : canDelete;
  const canWorkflowComplete = Boolean(isWorkflow && approvalStatus === "reviewing" && currentExecutionTask);

  async function handleApprovalAction(action: "approve" | "reject", comment = "") {
    const task = action === "approve" ? currentApprovalTask : activeTasks.find((item) => item.id === rejectTaskId);
    if (!task?.id || !record) return;
    setTaskSubmitting(true);
    try {
      const request = {
        path: { taskUuid: task.id },
        body: { comment: comment.trim() || undefined },
        responseStyle: "fields" as const,
      };
      const result = action === "approve" ? await approveWorkflowTask(request) : await rejectWorkflowTask(request);
      unwrapApiResult(result, "审批任务处理失败");
      notify.success(action === "approve" ? "已同意审批" : "已拒绝审批");
      setRejectTaskId(null);
      setRejectComment("");
      await Promise.all([runtimeQuery.refetch(), onWorkflowTaskHandled?.()]);
      onOpenChange(false);
    } catch (cause) {
      notifyRequestError(cause, "审批任务处理失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function handleWorkflowActionClick(action: "reverse" | "withdraw") {
    if (!onWorkflowAction || taskSubmitting) return;
    setTaskSubmitting(true);
    try {
      if (await onWorkflowAction(action)) {
        await onWorkflowTaskHandled?.();
        onOpenChange(false);
      }
    } finally {
      setTaskSubmitting(false);
    }
  }

  function submit(mode: "save" | "complete") {
    if (!record) return;
    onSubmitMode?.(mode);
    (document.getElementById(`record-detail-${record.id}`) as HTMLFormElement | null)
      ?.requestSubmit();
  }

  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="theme-modal-backdrop"
      style={{ WebkitBackdropFilter: "none", backdropFilter: "none" }}
      isDismissable
    >
      <Drawer.Content placement="right">
        <Drawer.Dialog
          className={`flex h-[100dvh] w-[100vw] max-w-[100vw] flex-col overflow-hidden bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)] ${isFullscreen ? "sm:w-screen sm:max-w-screen" : "sm:w-[60vw] sm:max-w-[60vw]"}`}
        >
          <Drawer.Header className="flex-col items-stretch gap-4">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="min-w-0">
                <Drawer.Heading className="truncate text-lg font-semibold">
                  {isEditing ? "编辑数据" : builtIns?.instanceTitle ?? formName}
                </Drawer.Heading>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onPrevious || onNext || onCopy ? (
                  <>
                    <Button
                      isIconOnly
                      variant="ghost"
                      aria-label={isFullscreen ? "退出全屏" : "全屏查看"}
                      className="h-8 w-8"
                      onPress={() => setIsFullscreen((current) => !current)}
                    >
                      <ArrowsExpand className="h-4 w-4" />
                    </Button>
                    {onPrevious ? (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="上一条数据"
                        className="h-8 w-8"
                        isDisabled={previousDisabled}
                        onPress={onPrevious}
                      >
                        <ArrowChevronLeft className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {onNext ? (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="下一条数据"
                        className="h-8 w-8"
                        isDisabled={nextDisabled}
                        onPress={onNext}
                      >
                        <ArrowChevronRight className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {onCopy ? (
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label="复制该数据"
                        className="h-8 w-8"
                        onPress={onCopy}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Dropdown>
                      <Dropdown.Trigger
                        aria-label="更多详情操作"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)]"
                      >
                        <Ellipsis className="h-4 w-4" />
                      </Dropdown.Trigger>
                      <Dropdown.Popover>
                        <Dropdown.Menu aria-label="更多详情操作">
                          {onCopy ? (
                            <Dropdown.Item id="copy-json" onAction={onCopy}>
                              复制 JSON
                            </Dropdown.Item>
                          ) : null}
                          <Dropdown.Item id="record-id" isDisabled>
                            记录 ID：{record?.id ?? "-"}
                          </Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                  </>
                ) : null}
                <Drawer.CloseTrigger aria-label="关闭详情">
                  <Xmark className="h-4 w-4" />
                </Drawer.CloseTrigger>
              </div>
            </div>
            {builtIns ? (
              <div className="flex justify-between">
                <DetailBuiltIn label="提交时间" value={builtIns.createdAt ?? "-"} />
                <DetailBuiltIn label="创建人" value={builtIns.submitter ?? "-"} />
                <DetailBuiltIn
                  label="创建人所属组织"
                  value={builtIns.submitterOrganization ?? "-"}
                />
                <DetailBuiltIn label="实例 ID" value={builtIns.instanceId ?? "-"} />
              </div>
            ) : null}
          </Drawer.Header>
          <Drawer.Body className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="min-h-64 animate-pulse rounded-lg bg-[var(--color-bg-subtle)]" />
            ) : error ? (
              <div className="py-10 text-center text-sm text-[var(--color-danger)]" role="alert">
                {error}
              </div>
            ) : null}
            {!loading && !error && record && schema && isContentReady ? (
              <RuntimeFormSurface>
                <RuntimeFormPanel
                  key={`${record.id}-${isEditing ? "edit" : "view"}`}
                  formId={`record-detail-${record.id}`}
                  recordUuid={record.id}
                  schema={schema}
                  initialValues={record.data}
                  isReadOnly={!isEditing}
                  readOnlyDisplay={!isEditing}
                  showSubmitButton={false}
                  submitLabel="保存修改"
                  submitting={submitting}
                  urlParams={urlParams}
                  onSubmit={
                    canWorkflowComplete && currentExecutionTask?.id && onCompleteExecutionTask
                      ? async (values) => {
                          const changes = Object.fromEntries(
                            Object.entries(values).filter(
                              ([key, value]) =>
                                JSON.stringify(value) !== JSON.stringify(record.data[key]),
                            ),
                          );
                          await onCompleteExecutionTask(currentExecutionTask.id!, changes);
                        }
                      : onSubmit ?? (async () => undefined)
                  }
                />
              </RuntimeFormSurface>
            ) : !loading && !error && record && schema ? (
              <div className="min-h-64 animate-pulse rounded-lg bg-[var(--color-bg-subtle)]" />
            ) : null}
            {record && showAuxiliary && !isEditing && onTabChange ? (
              <DetailAuxiliaryPanel
                activeTab={activeTab}
                record={record}
                onTabChange={onTabChange}
              />
            ) : null}
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onPress={() => onOpenChange(false)}>
              关闭
            </Button>
              {isEditing ? (
                <Button
                  variant="ghost"
                  isDisabled={submitting}
                  onPress={() => onEditingChange?.(false)}
                >
                  取消编辑
                </Button>
              ) : null}
              {isWorkflow && approvalStatus === "reviewing" && isSubmitter ? (
                <Button
                  variant="secondary"
                  isDisabled={submitting}
                  onPress={() => void handleWorkflowActionClick("withdraw")}
                >
                  撤销
                </Button>
              ) : null}
              {isWorkflow && approvalStatus === "reviewing" && currentApprovalTask ? (
                <>
                <Button variant="danger-soft" isDisabled={submitting || taskSubmitting} onPress={() => setRejectTaskId(currentApprovalTask.id ?? null)}>
                    拒绝
                  </Button>
                  <Button isDisabled={submitting || taskSubmitting} onPress={() => void handleApprovalAction("approve")}>
                    同意
                  </Button>
                </>
              ) : null}
              {isWorkflow && approvalStatus === "approved" ? (
                <Button variant="secondary" isDisabled={submitting || taskSubmitting} onPress={() => void handleWorkflowActionClick("reverse")}>
                  反审
                </Button>
              ) : null}
              {canWorkflowDelete ? (
                <Button
                  variant="danger-soft"
                  isDisabled={!record || isDeleting}
                  onPress={onDelete}
                >
                  {isDeleting ? "删除中..." : "删除"}
                </Button>
              ) : null}
              {canWorkflowEdit ? (
                <Button
                  isDisabled={!record || submitting}
                  onPress={() => {
                    if (!record) return;
                    if (!isEditing) onEditingChange?.(true);
                    else submit("save");
                  }}
                >
                  {isEditing ? (submitting ? "保存中..." : "保存") : "编辑"}
                </Button>
              ) : null}
              {canWorkflowComplete || canComplete ? (
                <Button
                  isDisabled={!record || submitting}
                  onPress={() => {
                    if (!record) return;
                    if (!isEditing) onEditingChange?.(true);
                    else if (canWorkflowComplete && currentExecutionTask?.id && onCompleteExecutionTask) {
                      submit("complete");
                    } else submit("complete");
                  }}
                >
                  {canWorkflowComplete ? (isEditing ? "保存并完成" : "填写并完成") : (isEditing ? "保存并完成" : "填写并完成")}
                </Button>
              ) : null}
          </Drawer.Footer>
          <Modal.Backdrop isOpen={rejectTaskId !== null} onOpenChange={(open) => { if (!open) setRejectTaskId(null); }} className="theme-modal-backdrop" isDismissable={!submitting}>
            <Modal.Container placement="center" size="sm">
              <Modal.Dialog>
                <Modal.Header><Modal.Heading>拒绝审批</Modal.Heading></Modal.Header>
                <Modal.Body><TextArea aria-label="拒绝意见" value={rejectComment} onChange={(event) => setRejectComment(event.currentTarget.value)} placeholder="请填写拒绝意见" /></Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onPress={() => setRejectTaskId(null)}>取消</Button>
                  <Button variant="danger-soft" isDisabled={submitting || taskSubmitting || !rejectComment.trim()} onPress={() => void handleApprovalAction("reject", rejectComment)}>确认拒绝</Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
