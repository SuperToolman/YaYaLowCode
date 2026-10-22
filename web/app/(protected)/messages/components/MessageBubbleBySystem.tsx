import { Avatar, Button, Typography } from "@heroui/react";
import { Bell } from "@gravity-ui/icons";
import { isAttachmentFilename } from "./file-presentation";
import { MessageAttachments, MessageBubble, type MessageBubbleProps } from "./MessageBubble";

type SystemMessagePayload = {
  cardType?: string;
  title?: string;
  content?: string;
  actions?: Array<{ id?: string; label?: string }>;
};

export function MessageBubbleBySystem(props: MessageBubbleProps) {
  const { message, onApprovalAction } = props;
  const card = (message.payload ?? {}) as SystemMessagePayload;

  return (
    <MessageBubble
      {...props}
      mine={false}
      canRecall={false}
      senderName="系统通知"
      senderAvatar={
        <Avatar size="sm" aria-label="系统通知头像">
          <Avatar.Fallback><Bell width={18} height={18} /></Avatar.Fallback>
        </Avatar>
      }
    >
      <div className="flex flex-col gap-2">
        {card.title ? <Typography weight="semibold">{card.title}</Typography> : null}
        {(!message.attachments.length || !isAttachmentFilename(card.content ?? message.content, message.attachments)) ? <Typography.Paragraph className="whitespace-pre-wrap break-words">
          {card.content ?? message.content}
        </Typography.Paragraph> : null}
        <MessageAttachments message={message} />
        {card.cardType === "approval" && card.actions?.length ? (
          <div className="flex flex-wrap gap-2">
            {card.actions
              .filter((action) => action.id === "approve" || action.id === "reject")
              .map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  onPress={() => void onApprovalAction(action.id as "approve" | "reject")}
                >
                  {action.label ?? action.id}
                </Button>
              ))}
          </div>
        ) : null}
      </div>
    </MessageBubble>
  );
}
