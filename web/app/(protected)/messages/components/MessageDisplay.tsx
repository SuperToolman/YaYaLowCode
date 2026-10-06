import { useLayoutEffect, useRef } from "react";
import { Button, ScrollShadow } from "@heroui/react";
import type { CommunicationConversationResponse, CommunicationMessageResponse } from "@features/communication/api";
import { Empty } from "./Empty";
import { MessageBubble } from "./MessageBubble";

export type DisplayMessage = CommunicationMessageResponse & {
  deliveryState?: "sending" | "failed" | "delivered";
};

export function MessageDisplay({
  conversation,
  messages,
  currentUserId,
  currentUserName,
  currentTime,
  nextBeforeSequence,
  onLoadEarlier,
  onRecall,
  onReedit,
  onRetry,
  onApprovalAction,
}: {
  conversation: CommunicationConversationResponse | null;
  messages: DisplayMessage[];
  currentUserId?: string;
  currentUserName?: string;
  currentTime: number | null;
  nextBeforeSequence: number | null;
  onLoadEarlier: () => void;
  onRecall: (message: DisplayMessage) => void;
  onReedit: (message: DisplayMessage) => void;
  onRetry: (message: DisplayMessage) => void;
  onApprovalAction: (message: DisplayMessage, action: "approve" | "reject") => Promise<void>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const scroller = contentRef.current?.parentElement;
    if (!scroller || !scrollAnchor.current) return;
    scroller.scrollTop = scrollAnchor.current.top + scroller.scrollHeight - scrollAnchor.current.height;
    scrollAnchor.current = null;
  }, [messages]);
  return (
    <ScrollShadow className="min-h-0 flex-1 overflow-y-auto p-6">
      {conversation ? (
        <div ref={contentRef} className="flex min-w-0 flex-col gap-4">
          {nextBeforeSequence ? <Button onPress={() => {
            const scroller = contentRef.current?.parentElement;
            if (scroller) scrollAnchor.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
            onLoadEarlier();
          }}>加载更早消息</Button> : null}
          {messages.map((message) => {
            const sender = conversation.members.find((member) => member.userId === message.senderUserId);
            const mine = message.senderUserId === currentUserId;
            const role = conversation.members.find((member) => member.userId === currentUserId)?.role;
            const canRecall = mine && ((currentTime !== null && currentTime - new Date(message.createdAt).getTime() < 2 * 60_000) || (conversation.conversationType === "group" && (role === "owner" || role === "admin")));
            return (
              <MessageBubble
                key={message.id}
                message={message}
                mine={mine}
                canRecall={canRecall}
                senderName={sender?.displayName ?? (mine ? (currentUserName ?? "当前用户") : "成员")}
                senderAvatarUrl={sender?.avatarUrl}
                onRecall={() => onRecall(message)}
                onReedit={() => onReedit(message)}
                onRetry={() => onRetry(message)}
                onApprovalAction={(action) => onApprovalAction(message, action)}
              />
            );
          })}
          {messages.length === 0 ? <Empty text="还没有消息" /> : null}
        </div>
      ) : <Empty text="没有选中的会话" />}
    </ScrollShadow>
  );
}
