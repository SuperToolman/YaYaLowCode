"use client";

import { ArrowDownToLine, File, FileCode, FileLetterP, FileLetterW, FileLetterX, FileText, FileZipper, Folder, Picture } from "@gravity-ui/icons";
import { ScrollShadow } from "@heroui/react";
import type { WorkspaceFile, FilePreview } from "../client";

interface WorkspaceFilesProps {
  sessionId: string | null;
  outputFiles: WorkspaceFile[];
  previews?: FilePreview[];
}

export function WorkspaceFiles({ sessionId, outputFiles, previews = [] }: WorkspaceFilesProps) {
  const previewByFile = new Map(previews.map(preview => [preview.fileId, preview]));
  const groups = [
    { label: "生成文件", files: outputFiles.filter(file => file.source === "generated") },
    { label: "上传文件", files: outputFiles.filter(file => file.source !== "generated") },
  ];

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden" aria-label="会话工作区">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Folder className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 text-sm font-medium">会话工作区</h2>
          {sessionId ? <span className="rounded-md bg-subtle px-2 py-0.5 text-xs tabular-nums text-muted">{outputFiles.length}</span> : null}
        </div>
        <p className="text-xs text-muted">本次会话的附件与生成文件</p>
      </header>
      <div className="min-h-0 flex-1">
        <ScrollShadow className="h-full min-h-0">
          {!sessionId || outputFiles.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-3 py-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-subtle text-muted">
                <Folder className="size-6" aria-hidden="true" />
              </span>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{sessionId ? "本会话暂无文件" : "选择会话以查看文件"}</p>
                <p className="text-xs leading-5 text-muted">{sessionId ? "上传的附件和 AI 员工生成的文件会显示在这里" : "会话中的附件与成果文件会集中保存在这里"}</p>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-5 pb-1">
              {groups.filter(group => group.files.length > 0).map(group => (
                <section key={group.label} aria-label={group.label} className="min-w-0">
                  <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted">
                    {group.label}<span className="tabular-nums">{group.files.length}</span>
                  </h3>
                  <div className="flex min-w-0 flex-col gap-2">
                    {group.files.map(file => (
                      <a key={file.id} href={file.downloadUrl} target="_blank" rel="noreferrer"
                        title={file.name} aria-label={`下载文件 ${file.name}`}
                        className="group flex min-w-0 items-center gap-2.5 rounded-xl bg-subtle p-2.5 text-left transition-colors hover:bg-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-surface)]">
                          <FileTypeIcon file={file} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                            <span className="shrink-0 tabular-nums">{formatFileSize(file.size)}</span>
                            <PreviewStatus status={previewByFile.get(file.id)?.status} />
                          </span>
                        </span>
                        <ArrowDownToLine className="size-3.5 shrink-0 text-muted transition-colors group-hover:text-foreground group-focus-visible:text-foreground" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </ScrollShadow>
      </div>
    </section>
  );
}

function PreviewStatus({ status }: { status?: string }) {
  const label = {
    completed: "已解析样本",
    parsing: "解析中",
    failed: "解析失败",
    skipped: "未解析",
  }[status ?? ""];
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${status === "failed" ? "text-danger" : ""}`}>
      <span className={`size-1 shrink-0 rounded-full ${status === "completed" ? "bg-success" : status === "failed" ? "bg-danger" : status === "parsing" ? "animate-pulse bg-warning motion-reduce:animate-none" : "bg-muted"}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function FileTypeIcon({ file }: { file: WorkspaceFile }) {
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
