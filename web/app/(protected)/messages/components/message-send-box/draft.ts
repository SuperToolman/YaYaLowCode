import { formatFileSize } from "../file-presentation";
import type { JSONContent } from "@tiptap/react";

export type DraftAsset = { id: string; file?: File; fileId?: string; name: string; size: number; mimeType: string; url?: string; width?: number; height?: number; error?: string };
export type SendItem = { kind: "text"; content: string } | { kind: "file"; assetId: string };
export const emptyDraft = (): JSONContent => ({ type: "doc", content: [{ type: "paragraph" }] });
export function parseDraft(doc: JSONContent): SendItem[] {
  const result: SendItem[] = [];
  let text = "";
  const flush = () => { if (text.trim()) result.push({ kind: "text", content: text.trim() }); text = ""; };
  function visit(node: JSONContent) {
    if (node.type === "attachment") { flush(); result.push({ kind: "file", assetId: node.attrs?.id }); }
    else if (node.type === "text") text += node.text ?? "";
    else if (node.type === "mention") text += `@${node.attrs?.label ?? ""}`;
    else if (node.type === "hardBreak") text += "\n";
    else { node.content?.forEach(visit); if (node.type === "paragraph") text += "\n"; }
  }
  visit(doc); flush(); return result;
}
export function remainingDraft(items: SendItem[]): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: items.flatMap((item): JSONContent[] => item.kind === "file" ? [{ type: "attachment", attrs: { id: item.assetId } }] : [{ type: "text", text: item.content }, { type: "hardBreak" }]) }] };
}
export function imageSize(width: number, height: number) {
  const scale = Math.min(1, 200 / width, 144 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function validateFileSize(name: string, size: number, maxMb: number) {
  if (size > maxMb * 1024 * 1024) throw new Error(`“${name}”大小为 ${formatFileSize(size)}，超过当前单文件 ${maxMb} MB 上限`);
}
