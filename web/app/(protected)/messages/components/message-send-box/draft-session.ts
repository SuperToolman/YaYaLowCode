import type { JSONContent } from "@tiptap/react";
import {
  emptyDraft,
  parseDraft,
  remainingDraft,
  type DraftAsset,
  type SendItem,
} from "./draft";

// A page-scoped external store keeps in-flight batches and File objects alive across conversation switches.
export class DraftSession {
  doc: JSONContent;
  assets: Map<string, DraftAsset>;
  sending = false;
  private listeners = new Set<() => void>();
  constructor(doc = emptyDraft(), assets = new Map<string, DraftAsset>()) {
    this.doc = doc;
    this.assets = assets;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  setDocument(doc: JSONContent) {
    this.doc = doc;
    const ids = new Set(
      parseDraft(doc).flatMap((item) =>
        item.kind === "file" ? [item.assetId] : [],
      ),
    );
    for (const [id, asset] of this.assets)
      if (!ids.has(id)) {
        this.release(asset);
        this.assets.delete(id);
      }
    this.emit();
  }
  begin() {
    if (this.sending) return false;
    this.sending = true;
    this.emit();
    return true;
  }
  finish(remaining: SendItem[]) {
    this.sending = false;
    this.setDocument(
      remaining.length === parseDraft(this.doc).length
        ? this.doc
        : remainingDraft(remaining),
    );
  }
  dispose() {
    this.assets.forEach((asset) => this.release(asset));
    this.assets.clear();
    this.listeners.clear();
  }
  private release(asset: DraftAsset) {
    if (asset.url?.startsWith("blob:")) URL.revokeObjectURL(asset.url);
  }
}
export async function submitBatch(
  items: SendItem[],
  submit: (item: SendItem) => Promise<void>,
) {
  let accepted = 0;
  try {
    for (const item of items) {
      await submit(item);
      accepted++;
    }
    return { remaining: [] as SendItem[] };
  } catch (error) {
    return { remaining: items.slice(accepted), error };
  }
}
