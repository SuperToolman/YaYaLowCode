"use client";

import { Button, Chip } from "@heroui/react";
import { Xmark } from "@gravity-ui/icons";
export type ComposeAttachment = { id: string; file: File };
export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export function ComposeAttachments({ attachments, disabled, onRemove }: { attachments: ComposeAttachment[]; disabled: boolean; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return <section aria-label="待发送附件" className="flex shrink-0 flex-wrap gap-2 py-2">
    {attachments.map(({ id, file }) => <Chip key={id}><span className="max-w-64 truncate" title={file.name}>{file.name}</span><span className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</span><Button size="sm" isIconOnly aria-label={`移除附件 ${file.name}`} isDisabled={disabled} onPress={() => onRemove(id)}><Xmark /></Button></Chip>)}
  </section>;
}
export async function encodeAttachment(file: File) {
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取附件：${file.name}`));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
  return { filename: file.name, contentType: file.type || "application/octet-stream", contentBase64 };
}
