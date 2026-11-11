import { Avatar } from "@heroui/react";
import { Bell } from "@gravity-ui/icons";
import { MessageBubble, type MessageBubbleProps } from "./MessageBubble";
import { SystemMessageCard } from "./system-cards/SystemMessageCard";

export function MessageBubbleBySystem(props: MessageBubbleProps) {
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
      <SystemMessageCard
        message={props.message}
        onApprovalAction={props.onApprovalAction}
      />
    </MessageBubble>
  );
}
