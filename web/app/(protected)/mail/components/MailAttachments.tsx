"use client";
import { notifyRequestError } from "@lib/notify";

import { useRef, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { ArrowDownToLine, Paperclip } from "@gravity-ui/icons";
import { downloadMailAttachment, type MailDetailResponse, type MailMessageIdentity } from "@features/mail/api";
import { notify } from "@lib/notify";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MailAttachments({ attachments, message }: { attachments: MailDetailResponse["attachments"]; message: MailMessageIdentity }) {
  const pending = useRef(new Set<number>());
  const [downloading, setDownloading] = useState(new Set<number>());
  async function download(attachment: MailDetailResponse["attachments"][number]) {
    if (pending.current.has(attachment.id)) return;
    pending.current.add(attachment.id);
    setDownloading(new Set(pending.current));
    try {
      const blob = await downloadMailAttachment(message, attachment.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.filename.replace(/[\x00-\x1f\x7f/\\]/g, "_");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      notifyRequestError(cause, "附件下载失败", { description: cause instanceof Error ? cause.message : "请稍后重试" });
    } finally {
      pending.current.delete(attachment.id);
      setDownloading(new Set(pending.current));
    }
  }
  if (!attachments.length) return null;
  return <section aria-label="邮件附件" className="shrink-0 rounded-lg border border-[var(--color-border)] p-2">
    <div className="mb-1 flex items-center gap-1 text-xs font-medium"><Paperclip className="size-3.5" />附件（{attachments.length}）</div>
    <ul className="m-0 grid list-none gap-1 p-0">
      {attachments.map(attachment => <li key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-md bg-[var(--color-bg-secondary)] px-2 py-1">
        <div className="min-w-0 flex-1">
          <div title={attachment.filename} className="truncate text-xs">{attachment.filename}</div>
          <div className="truncate text-[11px] text-[var(--color-text-secondary)]">{formatSize(attachment.size)} · {attachment.contentType}</div>
        </div>
        <Button size="sm" variant="ghost" aria-label={`下载 ${attachment.filename}`} isDisabled={downloading.has(attachment.id)} onPress={() => void download(attachment)}>
          {downloading.has(attachment.id) ? <Spinner size="sm" /> : <ArrowDownToLine className="size-3.5" />}下载
        </Button>
      </li>)}
    </ul>
  </section>;
}
