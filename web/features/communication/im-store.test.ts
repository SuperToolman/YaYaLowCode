import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CommunicationMessageResponse } from "./api";
import { ImStore } from "./im-store";

function message(sequence: number): CommunicationMessageResponse {
  return {
    id: `message-${sequence}`,
    conversationId: "conversation-1",
    senderUserId: "user-1",
    sequence,
    messageType: "text",
    content: `Message ${sequence}`,
    attachments: [],
    fileIds: [],
    payload: {},
    status: "active",
    createdAt: new Date(2026, 0, 1, 0, sequence).toISOString(),
    localId: `local-${sequence}`,
  };
}

describe("IM local store", () => {
  it("commits the message and cursor together, and rejects a gap", async () => {
    const store = new ImStore(`commit-${crypto.randomUUID()}`);
    expect(await store.applyMailboxEvent(2, message(2))).toBe(0);
    expect(await store.getMessages("conversation-1")).toEqual([]);
    expect(await store.applyMailboxEvent(1, message(1))).toBe(1);
    expect(await store.getCursor()).toBe(1);
    expect((await store.getMessages("conversation-1"))[0].id).toBe("message-1");
  });

  it("shares the committed cursor across windows and isolates accounts", async () => {
    const scope = `shared-${crypto.randomUUID()}`;
    const first = new ImStore(scope);
    const second = new ImStore(scope);
    const other = new ImStore(`${scope}-other`);
    await first.applyMailboxEvent(1, message(1));
    expect(await second.applyMailboxEvent(1, message(1))).toBe(1);
    expect(await second.getCursor()).toBe(1);
    expect(await other.getCursor()).toBe(0);
    expect(await other.getMessages("conversation-1")).toEqual([]);
  });

  it("keeps a queued localId until its mailbox message is committed", async () => {
    const store = new ImStore(`queued-${crypto.randomUUID()}`);
    await store.putPending({ localId: "local-1", conversationId: "conversation-1", messageType: "text", content: "Message 1", fileIds: [], createdAt: new Date().toISOString() });
    expect((await store.getPending()).map((item) => item.localId)).toEqual(["local-1"]);
    await store.applyMailboxEvent(1, message(1));
    expect(await store.getPending()).toEqual([]);
  });

  it("retains the newest 1000 messages without changing the cursor", async () => {
    const store = new ImStore(`prune-${crypto.randomUUID()}`);
    await store.applyMailboxEvent(1, message(1));
    await store.putMessages(Array.from({ length: 1000 }, (_, index) => message(index + 2)));
    const items = await store.getMessages("conversation-1", undefined, 1100);
    expect(items).toHaveLength(1000);
    expect(items[0].sequence).toBe(2);
    expect(await store.getCursor()).toBe(1);
  }, 15_000);
});

 it("preserves enqueue order for equal timestamps and keeps order when retrying", async () => {
  const store = new ImStore(crypto.randomUUID());
  const base = { conversationId: "c", messageType: "text", content: "hi", fileIds: [], createdAt: "2026-10-12T00:00:00.000Z" };
  await store.putPending({ ...base, localId: "z-first" });
  await store.putPending({ ...base, localId: "a-second" });
  await store.putPending({ ...base, localId: "z-first" });
  expect((await store.getPending()).map(item => item.localId)).toEqual(["z-first", "a-second"]);
});
