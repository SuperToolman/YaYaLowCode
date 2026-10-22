import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImClientAdapter, type ImEnvelope } from "./im-client";

class TestSocket {
  static OPEN = 1;
  readyState = 1;
  sent: Array<{ action?: string; data?: { mailboxSeq?: number; lastMailboxSeq?: number } }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { sockets.push(this); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(envelope: ImEnvelope) { this.onmessage?.({ data: JSON.stringify(envelope) }); }
}
const sockets: TestSocket[] = [];
const clients: ImClientAdapter[] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

function client(commandTransport = vi.fn().mockResolvedValue({ accepted: true })) {
  const adapter = new ImClientAdapter({
    url: "ws://localhost:8788/api/communication/ws",
    token: "test-token",
    userId: crypto.randomUUID(),
    commandTransport,
  });
  clients.push(adapter);
  return adapter;
}

describe("IM adapter", () => {
  afterEach(() => { clients.splice(0).forEach((item) => item.disconnect()); sockets.length = 0; vi.unstubAllGlobals(); });

  it("does not acknowledge a mailbox gap and applies buffered events in order", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const adapter = client();
    const applied: number[] = [];
    adapter.subscribe((event) => { if (event.event === "message.created") applied.push(event.mailboxSeq!); });
    await adapter.connect();
    const socket = sockets[0]; socket.onopen?.();
    socket.receive({ type: "event", event: "snapshot.started" });
    socket.receive({ type: "event", event: "message.created", mailboxSeq: 2, data: { id: "m2", conversationId: "c", sequence: 2 } });
    socket.receive({ type: "event", event: "snapshot.completed", mailboxSeq: 2 });
    await settle();
    expect(adapter.mailboxSeq).toBe(0);
    expect(adapter.connectionState).not.toBe("online");
    expect(socket.sent.filter((item) => item.action === "ack")).toEqual([]);
    socket.receive({ type: "event", event: "message.created", mailboxSeq: 1, data: { id: "m1", conversationId: "c", sequence: 1 } });
    await settle();
    expect(adapter.mailboxSeq).toBe(2);
    expect(adapter.connectionState).toBe("online");
    expect(applied).toEqual([1, 2]);
    expect(socket.sent.filter((item) => item.action === "ack").at(-1)?.data?.mailboxSeq).toBe(2);
  });

  it("submits queued messages serially even when a new send triggers another flush", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    let release!: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    let active = 0; let maximum = 0;
    const order: string[] = [];
    const transport = vi.fn(async (_action: string, data: unknown) => {
      const item = data as { localId: string }; active++; maximum = Math.max(maximum, active); order.push(item.localId);
      if (item.localId === "z-first") await first;
      active--; return { accepted: true };
    });
    const adapter = client(transport);
    const base = { conversationId: "c", messageType: "text", content: "hello", fileIds: [], createdAt: "2026-10-12T00:00:00.000Z" };
    await adapter.sendMessage({ ...base, localId: "z-first" });
    await adapter.connect(); const socket = sockets[0]; socket.onopen?.();
    socket.receive({ type: "event", event: "snapshot.completed", mailboxSeq: 0 }); await settle();
    await adapter.sendMessage({ ...base, localId: "a-second" }); await settle();
    expect(order).toEqual(["z-first"]); release(); await settle();
    expect(order).toEqual(["z-first", "a-second"]); expect(maximum).toBe(1);
  });

  it("persists an offline send and retries with its original localId", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const transport = vi.fn().mockResolvedValue({ accepted: true });
    const adapter = client(transport);
    await adapter.sendMessage({ localId: "stable-id", conversationId: "c", messageType: "text", content: "hello", fileIds: [], createdAt: new Date().toISOString() });
    expect((await adapter.getQueuedMessages())[0].localId).toBe("stable-id");
    await adapter.connect(); const socket = sockets[0]; socket.onopen?.();
    socket.receive({ type: "event", event: "snapshot.completed", mailboxSeq: 0 });
    await settle();
    expect(transport).toHaveBeenCalledWith("send", expect.objectContaining({ localId: "stable-id", conversationId: "c" }), expect.any(String));
    expect((await adapter.getQueuedMessages())[0].localId).toBe("stable-id");
    socket.receive({ type: "event", event: "message.created", mailboxSeq: 1, data: { id: "server-id", localId: "stable-id", conversationId: "c", sequence: 1 } });
    await settle();
    expect(await adapter.getQueuedMessages()).toEqual([]);
  });

  it("does not ACK when the local transaction fails", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const adapter = client();
    vi.spyOn(adapter.store, "applyMailboxEvent").mockRejectedValueOnce(new Error("quota exceeded"));
    await adapter.connect(); const socket = sockets[0]; socket.onopen?.();
    socket.receive({ type: "event", event: "message.created", mailboxSeq: 1, data: { id: "m1", conversationId: "c", sequence: 1 } });
    await settle();
    expect(adapter.mailboxSeq).toBe(0);
    expect(socket.sent.filter((item) => item.action === "ack")).toEqual([]);
  });

  it("resets an expired cursor to the server retention baseline", async () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const adapter = client();
    await adapter.connect(); const socket = sockets[0]; socket.onopen?.();
    socket.receive({ type: "event", event: "sync.reset_required", data: { oldestMailboxSeq: 7 } });
    await settle();
    expect(adapter.mailboxSeq).toBe(6);
    expect(socket.sent.filter((item) => item.action === "sync").at(-1)?.data?.lastMailboxSeq).toBe(6);
  });
});
