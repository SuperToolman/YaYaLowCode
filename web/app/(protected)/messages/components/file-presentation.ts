import type { CommunicationMessageResponse } from "@features/communication/api";
export function fileCategory(name: string, mime: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["doc", "docx", "odt"].includes(ext)) return "Word";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "Excel";
  if (["ppt", "pptx", "odp"].includes(ext)) return "PPT";
  if (ext === "pdf") return "PDF";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "压缩包";
  if (mime.startsWith("audio/")) return "音频";
  if (mime.startsWith("video/")) return "视频";
  return "文件";
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const FILE_TYPES = {
  Word: { color: "#3b82f6", symbol: "W" },
  Excel: { color: "#16a34a", symbol: "X" },
  PPT: { color: "#f97316", symbol: "P" },
  PDF: { color: "#ef4444", symbol: "PDF" },
  "压缩包": { color: "#a855f7", symbol: "ZIP" },
  "音频": { color: "#14b8a6", symbol: "" },
  "视频": { color: "#ec4899", symbol: "" },
  "文件": { color: "#64748b", symbol: "" },
} as const;
export function filePresentation(name: string, mime: string) {
  const category = fileCategory(name, mime);
  return { category, ...FILE_TYPES[category] };
}
export function isAttachmentOnlyMessage(message: CommunicationMessageResponse) {
  return message.status !== "recalled" && message.messageType === "file"
    && message.attachments.length > 0
    && isAttachmentFilename(message.content, message.attachments);
}

export function isAttachmentFilename(content: string, attachments: Array<{ name: string }>) {
  return !content.trim() || attachments.some(file => file.name === content.trim());
}
