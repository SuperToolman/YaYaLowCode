import { Card, ScrollShadow, Tabs } from "@heroui/react";
import { useState } from "react";
import { MyAvatar } from "@/shared/ui/MyAvatar";
import type { CommunicationConversationResponse } from "@/features/communication/api";

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
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const visibleConversations = filter === "unread"
    ? conversations.filter((item) => item.unreadCount > 0)
    : conversations;

  return (
    <Card className="flex min-h-0 min-w-0 flex-col">
      <Tabs
        selectedKey={filter}
        onSelectionChange={(key) => setFilter(String(key) as "all" | "unread")}
        aria-label="会话筛选"
        className="px-2 pt-2"
      >
        <Tabs.List className="w-full">
          <Tabs.Tab id="all" className="flex-1">
            全部
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="unread" className="flex-1">
            未读
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <ScrollShadow className="min-h-0 flex-1 overflow-y-auto">
        {visibleConversations.map((item) => {
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
        {visibleConversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-[var(--color-text-secondary)]">
            {filter === "unread" ? "没有未读会话" : "暂无会话"}
          </p>
        ) : null}
      </ScrollShadow>
    </Card>
  );
}
