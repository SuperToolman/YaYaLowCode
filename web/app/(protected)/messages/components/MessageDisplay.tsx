import { useLayoutEffect, useRef } from "react";
import { Button, ScrollShadow } from "@heroui/react";
import type {
  CommunicationConversationResponse,
  CommunicationMessageResponse,
} from "@features/communication/api";
import { MessageImageGallery } from "./MessageImage";
import { Empty } from "./Empty";
import { MessageBubble } from "./MessageBubble";
import { MessageBubbleBySystem } from "./MessageBubbleBySystem";
import { formatMessageDividerTime, groupMessages } from "./message-groups";

export type DisplayMessage = CommunicationMessageResponse & {
  deliveryState?: "sending" | "failed" | "delivered";
};

export function MessageDisplay({
  conversation,
  messages,
  currentUserId,
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
  currentTime: number | null;
  nextBeforeSequence: number | null;
  onLoadEarlier: () => void;
  onRecall: (message: DisplayMessage) => void;
  onReedit: (message: DisplayMessage) => void;
  onRetry: (message: DisplayMessage) => void;
  onApprovalAction: (
    message: DisplayMessage,
    action: "approve" | "reject",
  ) => Promise<void>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const scroller = contentRef.current?.parentElement;
    if (!scroller || !scrollAnchor.current) return;
    scroller.scrollTop =
      scrollAnchor.current.top + scroller.scrollHeight - scrollAnchor.current.height;
    scrollAnchor.current = null;
  }, [messages]);

  return (
    <MessageImageGallery conversationId={conversation?.id ?? "none"} messages={messages}>
    <ScrollShadow className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      {conversation ? (
        <div ref={contentRef} className="flex min-w-0 flex-col">
          {nextBeforeSequence ? (
            <Button
              className="self-center"
              onPress={() => {
                const scroller = contentRef.current?.parentElement;
                if (scroller)
                  scrollAnchor.current = {
                    height: scroller.scrollHeight,
                    top: scroller.scrollTop,
                  };
                onLoadEarlier();
              }}
            >
              加载更早消息
            </Button>
          ) : null}
          {groupMessages(messages).map((entry) => {
            const { message } = entry;
            const Bubble = message.messageType === "system" ? MessageBubbleBySystem : MessageBubble;
            const sender = conversation.members.find(
              (member) => member.userId === message.senderUserId,
            );
            const mine = message.senderUserId === currentUserId;
            const role = conversation.members.find(
              (member) => member.userId === currentUserId,
            )?.role;
            const canRecall =
              mine &&
              ((currentTime !== null &&
                currentTime - new Date(message.createdAt).getTime() <
                  2 * 60_000) ||
                (conversation.conversationType === "group" &&
                  (role === "owner" || role === "admin")));

            return (
              <div
                key={message.id}
                className={`flex min-w-0 flex-col ${entry.showTimeDivider ? "mt-5 first:mt-0" : "mt-2"}`}
              >
                {entry.showTimeDivider ? (
                  <div className="flex justify-center">
                    <time className="text-xs text-[var(--color-text-secondary)]">
                      {formatMessageDividerTime(
                        message.createdAt,
                        currentTime ?? Date.now(),
                      )}
                    </time>
                  </div>
                ) : null}
                <Bubble
                  message={message}
                  mine={mine}
                  showSenderIdentity={entry.showSenderIdentity}
                  canRecall={canRecall}
                  senderName={sender?.displayName ?? "成员"}
                  senderAvatarUrl={sender?.avatarUrl}
                  onRecall={() => onRecall(message)}
                  onReedit={() => onReedit(message)}
                  onRetry={() => onRetry(message)}
                  onApprovalAction={(action) =>
                    onApprovalAction(message, action)
                  }
                />
              </div>
            );
          })}
          {messages.length === 0 ? <Empty text="还没有消息" /> : null}
        </div>
      ) : (
        <Empty text="没有选中的会话" />
      )}
    </ScrollShadow>
    </MessageImageGallery>
  );
}
