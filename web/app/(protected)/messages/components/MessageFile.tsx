"use client";
import type { CSSProperties } from "react";
import { Card, Link, Separator, Typography } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { ArrowDownToLine } from "@gravity-ui/icons";
import type { CommunicationAttachmentResponse } from "@lib/http";
import { FileTypeIcon } from "./FileTypeIcon";
import { filePresentation, formatFileSize } from "./file-presentation";
import styles from "./file-card.module.css";

export function MessageFile({
  attachment,
}: {
  attachment: CommunicationAttachmentResponse;
}) {
  const type = filePresentation(attachment.name, attachment.mimeType);
  return (
    <Card
      aria-label={`文件：${attachment.name}`}
      data-file-type={type.category}
      className={`w-80 max-w-full gap-3 p-3 text-start ${styles.fileCard}`}
      style={{ "--file-color": type.color } as CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileTypeIcon name={attachment.name} mimeType={attachment.mimeType} />
        <div className="min-w-0 flex-1">
          <Typography
            weight="semibold"
            className="block truncate"
            title={attachment.name}
          >
            {attachment.name}
          </Typography>
          <Typography className="block text-xs">
            {formatFileSize(attachment.size)} · {type.category}
          </Typography>
        </div>
      </div>
      <div className="flex justify-end">
        <Link
          href={`/api/files/${encodeURIComponent(attachment.fileId)}/download`}
          download={attachment.name}
          aria-label={`下载 ${attachment.name}`}
          className={buttonVariants({ size: "sm", variant: "secondary" })}
        >
          <ArrowDownToLine />
          下载
        </Link>
      </div>
    </Card>
  );
}
