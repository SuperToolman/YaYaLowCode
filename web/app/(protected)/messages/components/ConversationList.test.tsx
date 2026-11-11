import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommunicationConversationResponse } from "@/features/communication/api";
import { ConversationList } from "./ConversationList";

const conversations: CommunicationConversationResponse[] = [
  {
    id: "unread-conversation",
    conversationType: "direct",
    title: "未读联系人",
    members: [],
    lastMessageSequence: 2,
    unreadCount: 2,
  },
  {
    id: "read-conversation",
    conversationType: "direct",
    title: "已读联系人",
    members: [],
    lastMessageSequence: 1,
    unreadCount: 0,
  },
];

describe("ConversationList", () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(Element.prototype, "getAnimations");
    vi.unstubAllGlobals();
  });

  it("filters unread conversations and reflects them becoming read", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    const { rerender } = render(
      <ConversationList
        conversations={conversations}
        selectedId={null}
        onSelect={() => undefined}
        formatTime={() => ""}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "未读" }));
    expect(screen.getByText("未读联系人")).toBeTruthy();
    expect(screen.queryByText("已读联系人")).toBeNull();

    rerender(
      <ConversationList
        conversations={conversations.map((item) =>
          item.id === "unread-conversation" ? { ...item, unreadCount: 0 } : item,
        )}
        selectedId={null}
        onSelect={() => undefined}
        formatTime={() => ""}
      />,
    );
    expect(screen.getByText("没有未读会话")).toBeTruthy();
  });
});
