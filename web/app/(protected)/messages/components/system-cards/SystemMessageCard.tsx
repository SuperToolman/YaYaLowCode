import { Typography } from "@heroui/react";
import { isAttachmentFilename } from "../file-presentation";
import { MessageAttachments, type MessageBubbleProps } from "../MessageBubble";
import { ApprovalSystemCard } from "./ApprovalSystemCard";

export type SystemCardPayload = {
  cardType?: string;
  title?: string;
  content?: string;
  result?: "approved" | "rejected" | "stale" | "withdrawn";
  appId?: string | null;
  formUuid?: string;
  formName?: string | null;
  flowName?: string | null;
  submitter?: string | null;
  startedAt?: string | null;
  task?: { nodeLabel?: string; taskType?: string } | null;
  recordUuid?: string;
  taskUuid?: string;
  actions?: Array<{ id?: string; label?: string }>;
};

export function SystemMessageCard({
  message,
  onApprovalAction,
}: Pick<MessageBubbleProps, "message" | "onApprovalAction">) {
  const card = (message.payload ?? {}) as SystemCardPayload;
  const content = card.content ?? message.content;
  const showContent =
    !message.attachments.length ||
    !isAttachmentFilename(content, message.attachments);
  const title = card.result === "approved"
    ? "审批已通过"
    : card.result === "rejected"
      ? "审批已拒绝"
      : card.result === "stale"
        ? "审批已失效"
        : card.result === "withdrawn"
          ? "提交人已撤回"
        : card.title;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title ? <Typography weight="semibold">{title}</Typography> : null}
      {showContent ? (
        <Typography.Paragraph className="whitespace-pre-wrap break-words">
          {content}
        </Typography.Paragraph>
      ) : null}
      <MessageAttachments message={message} />
      {card.cardType === "approval" ? (
        <ApprovalSystemCard
          card={card}
          onApprovalAction={onApprovalAction}
        />
      ) : null}
    </div>
  );
}
