"use client";

import {
  File,
  FileCode,
  FileLetterP,
  FileLetterW,
  FileLetterX,
  FileText,
  FileZipper,
  Picture,
} from "@gravity-ui/icons";
import { Card, ScrollShadow } from "@heroui/react";
import type { AgentFile } from "@/features/agent-assistant/api";

interface WorkspaceFilesProps {
  sessionId: string | null;
  outputFiles: AgentFile[];
}

export function WorkspaceFiles({ sessionId, outputFiles }: WorkspaceFilesProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <Card.Header>
        <Card.Title className="text-sm">产物文件 {outputFiles.length ? `(${outputFiles.length})` : ""}</Card.Title>
      </Card.Header>
      <Card.Content className="min-h-0 flex-1">
        <ScrollShadow className="h-full">
          {!sessionId ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted">选择会话以查看产物</div>
          ) : outputFiles.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted">本会话暂无产物</div>
          ) : (
            <div className="flex flex-col gap-3">
              {outputFiles.map((file) => (
                <a
                  key={file.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg text-left hover:bg-default-100"
                  href={`/api/agent/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(file.id)}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileTypeIcon file={file} />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted">{formatFileSize(file.size)}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </ScrollShadow>
      </Card.Content>
    </Card>
  );
}

function FileTypeIcon({ file }: { file: AgentFile }) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const className = "size-5 shrink-0";
  if (["xlsx", "xls", "csv"].includes(extension ?? "")) return <FileLetterX className={`${className} text-green-500`} />;
  if (["doc", "docx"].includes(extension ?? "")) return <FileLetterW className={`${className} text-blue-500`} />;
  if (["ppt", "pptx"].includes(extension ?? "")) return <FileLetterP className={`${className} text-orange-500`} />;
  if (extension === "json") return <FileCode className={`${className} text-muted`} />;
  if (file.mimeType.startsWith("image/")) return <Picture className={`${className} text-fuchsia-500`} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "")) return <FileZipper className={`${className} text-amber-500`} />;
  if (["ts", "tsx", "js", "jsx", "py", "yaml", "yml", "xml", "html", "css", "sql", "sh", "ps1"].includes(extension ?? "")) return <FileCode className={`${className} text-accent`} />;
  if (extension === "pdf") return <FileText className={`${className} text-red-500`} />;
  if (file.mimeType.startsWith("text/")) return <FileText className={`${className} text-muted`} />;
  return <File className={`${className} text-muted`} />;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
