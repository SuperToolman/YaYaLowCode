import { describe, expect, it } from "vitest";
import type { CommunicationConversationResponse } from "@features/communication/api";
import { sortConversations } from "./conversation-sort";

const conversation = (id: string, lastMessageAt?: string | null) =>
  ({ id, lastMessageAt } as unknown as CommunicationConversationResponse);

describe("conversation sorting", () => {
  it("sorts by latest message and keeps empty conversations last", () => {
    expect(
      sortConversations([
        conversation("old", "2026-10-01T10:00:00Z"),
        conversation("empty"),
        conversation("new", "2026-10-06T10:00:00Z"),
      ]).map((item) => item.id),
    ).toEqual(["new", "old", "empty"]);
  });

  it("keeps equal timestamps stable", () => {
    expect(
      sortConversations([
        conversation("first", "2026-10-06T10:00:00Z"),
        conversation("second", "2026-10-06T10:00:00Z"),
      ]).map((item) => item.id),
    ).toEqual(["first", "second"]);
  });

  it("moves a conversation to the top when its latest message changes", () => {
    const items = [
      conversation("first", "2026-10-06T10:00:00Z"),
      conversation("second", "2026-10-06T10:01:00Z"),
    ];
    items[0].lastMessageAt = "2026-10-06T10:02:00Z";
    expect(sortConversations(items).map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });
});
