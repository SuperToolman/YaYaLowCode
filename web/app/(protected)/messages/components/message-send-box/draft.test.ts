import { fileCategory, formatFileSize } from "../file-presentation";
import { describe, expect, it, vi } from "vitest";
import { validateFileSize, imageSize, parseDraft, remainingDraft, type SendItem } from "./draft";
import { DraftSession, submitBatch } from "./draft-session";
describe("mixed message drafts", () => {
  it("keeps text, mention, emoji and files in their original order", () => {
    const items = parseDraft({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "你好😀" }, { type: "mention", attrs: { label: "小王", id: "u" } }, { type: "attachment", attrs: { id: "image" } }, { type: "text", text: "后面的文字" }, { type: "attachment", attrs: { id: "doc" } }] }] });
    expect(items).toEqual([{ kind: "text", content: "你好😀@小王" }, { kind: "file", assetId: "image" }, { kind: "text", content: "后面的文字" }, { kind: "file", assetId: "doc" }]);
    expect(parseDraft(remainingDraft(items))).toEqual(items);
  });
  it("ignores empty text without losing file-only drafts", () => {
    expect(parseDraft(remainingDraft([{ kind: "text", content: " \n" }, { kind: "file", assetId: "f" }]))).toEqual([{ kind: "file", assetId: "f" }]);
  });
  it.each([[400, 200, 200, 100], [100, 1000, 14, 144], [20, 10, 20, 10], [1000, 100, 200, 20]])("fits %sx%s without upscaling or cropping", (w, h, width, height) => {
    expect(imageSize(w, h)).toEqual({ width, height });
  });
  it("classifies document and media files", () => {
    expect(fileCategory("quote.xlsx", "")).toBe("Excel"); expect(fileCategory("archive.7z", "")).toBe("压缩包"); expect(fileCategory("movie", "video/mp4")).toBe("视频"); expect(fileCategory("unknown", "")).toBe("文件");
  });
  it("stops on a partial failure and retains only failed and unsent items", async () => {
    const items: SendItem[] = [{ kind: "text", content: "first" }, { kind: "file", assetId: "f" }, { kind: "text", content: "last" }];
    const submit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("upload failed"));
    const outcome = await submitBatch(items, submit);
    expect(submit).toHaveBeenCalledTimes(2); expect(outcome.remaining).toEqual(items.slice(1)); expect(outcome.error).toBeInstanceOf(Error);
    const retry = vi.fn().mockResolvedValue(undefined); await submitBatch(outcome.remaining, retry); expect(retry).toHaveBeenCalledTimes(2);
  });
  it("locks a conversation draft and releases preview URLs when successful items are removed", () => {
    const revoke = vi.fn(); vi.stubGlobal("URL", { revokeObjectURL: revoke });
    try {
      const session = new DraftSession(remainingDraft([{ kind: "file", assetId: "f" }]), new Map([["f", { id: "f", name: "f.png", size: 1, mimeType: "image/png", url: "blob:test" }]]));
      expect(session.begin()).toBe(true); expect(session.begin()).toBe(false); session.finish([]); expect(session.sending).toBe(false); expect(revoke).toHaveBeenCalledWith("blob:test"); expect(session.assets.size).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it("accepts files up to the configured limit and describes oversized files in MB", () => {
    expect(() => validateFileSize("report.pdf", 23 * 1024 * 1024, 50)).not.toThrow();
    expect(() => validateFileSize("report.pdf", 50 * 1024 * 1024, 50)).not.toThrow();
    expect(() => validateFileSize("report.pdf", 51 * 1024 * 1024, 50)).toThrow("超过当前单文件 50 MB 上限");
    expect(() => validateFileSize("report.pdf", 23 * 1024 * 1024, 20)).toThrow("23.0 MB");
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

});
