"use client";

import { CircleXmark, File, Paperclip, PaperPlane } from "@gravity-ui/icons";
import { Button, TextArea } from "@heroui/react";
import { useLayoutEffect, useRef, useState } from "react";
import { MySurface } from "@shared/ui/MySurface";

type ComposerFile = { file: File; key: string };

export function AgentMessageComposer({ value, loading, error, onChange, onSend, files = [], onFilesSelect, onFileSelect, onFileRemove, mode: _mode, onModeChange: _onModeChange }: { value: string; loading?: boolean; error?: string | null; onChange: (value: string) => void; onSend: () => void; files?: ComposerFile[]; onFilesSelect?: (files: File[]) => void; onFileSelect?: (file: File) => void; onFileRemove?: (key: string) => void; mode?: unknown; onModeChange?: (mode: never) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragActive, setDragActive] = useState(false);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    const maxHeight = lineHeight * 8;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  function addFiles(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []);
    if (selected.length) onFilesSelect?.(selected);
    if (selected[0]) onFileSelect?.(selected[0]);
  }

  return <MySurface className={`relative w-full p-3 ${dragActive ? "ring-2 ring-accent ring-offset-2" : ""}`}>
    <form onSubmit={(event) => { event.preventDefault(); onSend(); }} onDragEnter={(event) => { event.preventDefault(); if (!loading && event.dataTransfer.types.includes("Files")) setDragActive(true); }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false); }} onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!loading) addFiles(event.dataTransfer.files); }}>
      {files.length ? <div className="mb-3 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="待发送附件">{files.map(({ file, key }) => <div key={key} className="flex h-14 w-52 shrink-0 items-center gap-2 rounded-lg border border-default-200 bg-default-50 px-2"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-success/15 text-success"><File className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{file.name}</span><span className="block text-xs text-muted">{formatFileSize(file.size)}</span></span>{onFileRemove ? <Button isIconOnly size="sm" variant="ghost" aria-label={`移除 ${file.name}`} isDisabled={loading} onPress={() => onFileRemove(key)}><CircleXmark className="size-4" /></Button> : null}</div>)}</div> : null}
      <TextArea ref={textareaRef} aria-label="给 Agent 发送消息" fullWidth value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="输入消息..." rows={1} disabled={loading} className="resize-none bg-transparent" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="text-xs text-muted">权限由角色授权，高风险操作将请求确认</span>{onFilesSelect || onFileSelect ? <label className="cursor-pointer"><span role="button" tabIndex={loading ? -1 : 0} aria-label="上传文件" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-default-100"><Paperclip /></span><input className="hidden" type="file" multiple disabled={loading} onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} /></label> : null}</div>
        <Button type="submit" variant="ghost" isIconOnly aria-label="发送消息" isDisabled={loading || !value.trim()}><PaperPlane /></Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </form>
  </MySurface>;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
