import type { CommunicationConversationResponse, CommunicationMessageResponse } from "./api";

export type PendingImMessage = {
  localId: string;
  conversationId: string;
  messageType: string;
  content: string;
  fileIds: string[];
  emailSubject?: string;
  createdAt: string;
  queueOrder?: number;
};

type StoredMessage = CommunicationMessageResponse;
type MetaValue = { key: string; value: number | boolean };

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("本地消息存储失败"));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("本地消息写入失败"));
    transaction.onerror = () => reject(transaction.error ?? new Error("本地消息写入失败"));
  });
}

export class ImStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(readonly scope: string) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const opening = indexedDB.open(`yaya-im-${encodeURIComponent(this.scope)}`, 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        db.createObjectStore("conversations", { keyPath: "id" });
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("byConversationSequence", ["conversationId", "sequence"]);
        db.createObjectStore("pending", { keyPath: "localId" });
        db.createObjectStore("meta", { keyPath: "key" });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("无法打开本地消息存储"));
    });
    return this.dbPromise;
  }

  async getCursor(): Promise<number> {
    const db = await this.open();
    const tx = db.transaction("meta", "readonly");
    const row = await request(tx.objectStore("meta").get("cursor")) as MetaValue | undefined;
    return typeof row?.value === "number" ? row.value : 0;
  }

  async getConversations(): Promise<CommunicationConversationResponse[]> {
    const db = await this.open();
    return request(db.transaction("conversations", "readonly").objectStore("conversations").getAll());
  }

  async putConversations(items: CommunicationConversationResponse[]): Promise<void> {
    const db = await this.open();
    const tx = db.transaction("conversations", "readwrite");
    const store = tx.objectStore("conversations");
    store.clear();
    items.forEach((item) => store.put(item));
    await completed(tx);
  }

  async putMessages(items: StoredMessage[]): Promise<void> {
    if (!items.length) return;
    const db = await this.open();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    items.forEach((item) => store.put(item));
    await completed(tx);
    await this.prune(items[0].conversationId);
  }

  async applyMailboxEvent(seq: number, message?: StoredMessage): Promise<number> {
    const db = await this.open();
    const tx = db.transaction(["messages", "meta", "pending"], "readwrite");
    const meta = tx.objectStore("meta");
    const current = await request(meta.get("cursor")) as MetaValue | undefined;
    const cursor = typeof current?.value === "number" ? current.value : 0;
    if (seq === cursor + 1) {
      if (message) {
        tx.objectStore("messages").put(message);
        if (message.localId) tx.objectStore("pending").delete(message.localId);
      }
      meta.put({ key: "cursor", value: seq });
    }
    await completed(tx);
    if (message && seq === cursor + 1) await this.prune(message.conversationId);
    return seq === cursor + 1 ? seq : cursor;
  }

  async getMessages(conversationId: string, beforeSequence = Number.MAX_SAFE_INTEGER, limit = 50): Promise<StoredMessage[]> {
    const db = await this.open();
    const tx = db.transaction("messages", "readonly");
    const index = tx.objectStore("messages").index("byConversationSequence");
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, beforeSequence], false, true);
    const items: StoredMessage[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(range, "prev");
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row || items.length >= limit) return resolve();
        items.push(row.value as StoredMessage);
        row.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    return items.reverse();
  }

  async putPending(item: PendingImMessage): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["pending", "meta"], "readwrite");
    const pending = tx.objectStore("pending");
    const meta = tx.objectStore("meta");
    const existing = await request(pending.get(item.localId)) as PendingImMessage | undefined;
    const last = await request(meta.get("queueOrder")) as MetaValue | undefined;
    const order = existing?.queueOrder ?? (typeof last?.value === "number" ? last.value : 0) + 1;
    pending.put({ ...item, queueOrder: order });
    meta.put({ key: "queueOrder", value: Math.max(order, typeof last?.value === "number" ? last.value : 0) });
    await completed(tx);
  }

  async getPending(): Promise<PendingImMessage[]> {
    const db = await this.open();
    const items = await request(db.transaction("pending", "readonly").objectStore("pending").getAll()) as PendingImMessage[];
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.queueOrder ?? 0) - (b.queueOrder ?? 0) || a.localId.localeCompare(b.localId));
  }

  async deletePending(localId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction("pending", "readwrite");
    tx.objectStore("pending").delete(localId);
    await completed(tx);
  }

  async resetSync(baseline = 0): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["meta", "messages"], "readwrite");
    tx.objectStore("meta").put({ key: "cursor", value: baseline });
    tx.objectStore("messages").clear();
    await completed(tx);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["meta", "messages", "conversations", "pending"], "readwrite");
    for (const name of ["meta", "messages", "conversations", "pending"]) tx.objectStore(name).clear();
    await completed(tx);
  }

  private async prune(conversationId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction("messages", "readwrite");
    const index = tx.objectStore("messages").index("byConversationSequence");
    const range = IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER]);
    let count = 0;
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(range, "prev");
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return resolve();
        if (++count > 1000) row.delete();
        row.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await completed(tx);
  }
}
