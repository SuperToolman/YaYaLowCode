import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { unwrapApiResult } from "@/shared/lib/api-request";
import { getFormSchema, queryFormRecords } from "@/shared/lib/http";
import type { FormRecord } from "@/features/records/types";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import { RecordDetailDrawer } from "@/features/records/screen/components/record-detail/RecordDetailDrawer";
import type { SystemCardPayload } from "./SystemMessageCard";

export function ApprovalSystemCard({
  card,
  onApprovalAction,
}: {
  card: SystemCardPayload;
  onApprovalAction: (action: "approve" | "reject") => Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailSchema, setDetailSchema] = useState<RuntimeFormSchema | null>(null);
  const [detailRecord, setDetailRecord] = useState<FormRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const actionInFlight = useRef(false);
  const result = card.result ?? null;
  const startedAt = card.startedAt ? new Date(card.startedAt) : null;
  const canViewDetails = Boolean(card.appId && card.formUuid && card.recordUuid);

  useEffect(() => {
    if (!detailsOpen || !card.formUuid || !card.recordUuid) return;
    const controller = new AbortController();

    void Promise.resolve().then(async () => {
      setDetailLoading(true);
      setDetailError("");
      setDetailSchema(null);
      setDetailRecord(null);
      try {
        const recordResult = await queryFormRecords({
          path: { formUuid: card.formUuid! },
          body: {
            page: 1,
            pageSize: 1,
            filters: [{ fieldId: "id", operator: "eq", value: card.recordUuid! }],
            sorts: [],
          },
          responseStyle: "fields",
          signal: controller.signal,
        });
        const recordPage = unwrapApiResult(recordResult, "无法加载审批记录");
        const item = recordPage.items.find((candidate) => candidate.id === card.recordUuid);
        if (!item) throw new Error("审批记录不存在，或当前账号无权查看");
        if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) {
          throw new Error("审批记录数据格式无效");
        }

        const schemaResult = await getFormSchema({
          path: { formUuid: card.formUuid! },
          query: { version: item.schemaVersion },
          responseStyle: "fields",
          signal: controller.signal,
        });
        const schemaPayload = unwrapApiResult(schemaResult, "无法加载表单结构");
        const schema = (schemaPayload as { schema?: RuntimeFormSchema }).schema;
        if (!schema || !Array.isArray(schema.fields)) {
          throw new Error("表单 Schema 格式无效");
        }
        if (controller.signal.aborted) return;
        setDetailSchema(schema);
        setDetailRecord({ ...item, data: item.data as Record<string, unknown> } as FormRecord);
      } catch (cause) {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : "加载审批记录失败";
        setDetailError(message);
        notifyRequestError(cause, "无法查看审批详情", { description: message });
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    });

    return () => controller.abort();
  }, [card.formUuid, card.recordUuid, detailsOpen]);

  async function handleAction(action: "approve" | "reject") {
    if (actionInFlight.current || result) return;
    actionInFlight.current = true;
    setPendingAction(action);
    try {
      await onApprovalAction(action);
      notify.success(action === "approve" ? "已同意审批" : "已拒绝审批");
    } catch (cause) {
      const description = cause instanceof Error ? cause.message : "请稍后重试";
      if (description.includes("审批卡片已失效或版本不匹配")) {
      }
      notifyRequestError(cause, "审批操作失败", { description });
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={pendingAction !== null}>
      <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2 text-xs">
        {card.formName ? <><span className="text-[var(--color-text-secondary)]">审批表单</span><span className="min-w-0 break-words font-medium">{card.formName}</span></> : null}
        {card.flowName ? <><span className="text-[var(--color-text-secondary)]">审批流程</span><span className="min-w-0 break-words">{card.flowName}</span></> : null}
        {card.submitter ? <><span className="text-[var(--color-text-secondary)]">发起人</span><span className="min-w-0 break-words">{card.submitter}</span></> : null}
        {card.task?.nodeLabel ? <><span className="text-[var(--color-text-secondary)]">当前节点</span><span className="min-w-0 break-words">{card.task.nodeLabel}</span></> : null}
        {startedAt && !Number.isNaN(startedAt.getTime()) ? <><span className="text-[var(--color-text-secondary)]">发起时间</span><span>{startedAt.toLocaleString("zh-CN")}</span></> : null}
      </div>
      {result ? (
        <p className="m-0 text-xs text-[var(--color-text-secondary)]" role="status">
          {result === "approved"
            ? "已同意审批任务"
            : result === "rejected"
              ? "已拒绝审批任务"
              : result === "withdrawn"
                ? "提交人已撤回"
                : "审批卡片已失效或已处理，请刷新消息"}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canViewDetails ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setDetailsOpen(true)}
          >
            查看表单详情
          </Button>
        ) : null}
        {!result
          ? (card.actions ?? [])
              .filter((action) => action.id === "approve" || action.id === "reject")
              .map((action) => {
                const id = action.id as "approve" | "reject";
                return (
                  <Button
                    key={id}
                    size="sm"
                    isDisabled={pendingAction !== null}
                    onPress={() => void handleAction(id)}
                  >
                    {pendingAction === id ? "处理中…" : action.label ?? id}
                  </Button>
                );
              })
          : null}
      </div>
      {canViewDetails ? (
        <RecordDetailDrawer
          isOpen={detailsOpen}
          onOpenChange={setDetailsOpen}
          formName={card.formName ?? "审批详情"}
          schema={detailSchema}
          record={detailRecord}
          urlParams={{ appId: card.appId!, formUuid: card.formUuid! }}
          loading={detailLoading}
          error={detailError}
          isContentReady={!detailLoading && detailRecord !== null}
        />
      ) : null}
    </div>
  );
}
