import { Card, ScrollShadow } from "@heroui/react";
import { MyAvatar } from "@components/my-fields/MyAvatar";
import type { CommunicationConversationResponse } from "@features/communication/api";

export function ConversationList({
  conversations,
  selectedId,
  currentUserId,
  onSelect,
  formatTime,
}: {
  conversations: CommunicationConversationResponse[];
  selectedId: string | null;
  currentUserId?: string;
  onSelect: (conversationId: string) => void;
  formatTime: (value: string) => string;
}) {
  return (
    <Card className="flex min-h-0 min-w-0 flex-col">

      <ScrollShadow className="min-h-0 flex-1 overflow-y-auto">
        {conversations.map((item) => {
          const avatarMember =
            item.conversationType === "group"
              ? item.members[0]
              : (item.members.find((member) => member.userId !== currentUserId) ??
                item.members[0]);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md p-2 text-start hover:bg-[var(--color-control-selected)] ${item.id === selectedId ? "bg-[var(--color-control-selected)]" : ""}`}
            >
              <MyAvatar name={item.title} imageUrl={avatarMember?.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.title}
                  {item.conversationType === "group" ? (
                    <span className="ms-1.5 inline-flex rounded bg-[var(--color-primary-soft)] px-1 text-[0.625rem] font-medium text-[var(--color-primary)] align-middle">
                      群聊
                    </span>
                  ) : null}
                </span>
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
                  {item.lastMessagePreview ??
                    (item.conversationType === "group"
                      ? `${item.members.length} 位成员`
                      : "暂无消息")}
                </span>
              </span>
              <span className="flex min-w-10 flex-col items-end gap-1 self-stretch">
                {item.lastMessageAt ? (
                  <time className="whitespace-nowrap text-xs text-[var(--color-text-disabled)]">
                    {formatTime(item.lastMessageAt)}
                  </time>
                ) : null}
                {item.unreadCount > 0 ? (
                  <span className="min-w-5 rounded-full bg-[var(--color-danger)] px-1.5 text-center text-xs text-[var(--color-text-on-danger)]">
                    {item.unreadCount > 99 ? "99+" : item.unreadCount}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </ScrollShadow>
    </Card>
  );
}
