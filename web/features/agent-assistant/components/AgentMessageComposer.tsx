"use client";

import { ChevronDown, CircleInfo, CircleStop, CircleXmark, File, Paperclip, PaperPlane } from "@gravity-ui/icons";
import { Button, Popover, TextArea } from "@heroui/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { MySurface } from "@shared/ui/MySurface";

type ComposerFile = { file: File; key: string };
type ComposerCommand = { name: string; description: string };
type ComposerModel = { routeId: string; model: string; label: string };

// These DSH commands travel through the existing restricted session.prompt route;
// the palette is not a generic Host command API.
const DSH_COMMANDS: readonly ComposerCommand[] = [
  { name: "compact", description: "压缩当前会话的上下文" },
];

type AgentMessageComposerProps = {
  value: string;
  loading?: boolean;
  running?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  files?: ComposerFile[];
  onFilesSelect?: (files: File[]) => void;
  onFileSelect?: (file: File) => void;
  onFileRemove?: (key: string) => void;
  /** Display-only: model routing stays owned by Rust and the DSH host. */
  modelLabel?: string;
  modelOptions?: readonly ComposerModel[];
  onModelSelect?: (model: ComposerModel) => void;
  /** Display-only: browser code must not alter role-derived permissions. */
  accessLabel?: string;
  mode?: unknown;
  onModeChange?: (mode: never) => void;
};

export function AgentMessageComposer({ value, loading, running = false, error, onChange, onSend, onCancel, files = [], onFilesSelect, onFileSelect, onFileRemove, modelLabel = "选择模型", modelOptions = [], onModelSelect, accessLabel = "完全访问 · 由平台角色授权", mode: _mode, onModeChange: _onModeChange }: AgentMessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandQuery = value.trimStart().match(/^\/([^\s]*)/)?.[1]?.toLowerCase();
  const commands = useMemo(() => commandQuery === undefined ? [] : DSH_COMMANDS.filter(command => command.name.startsWith(commandQuery)), [commandQuery]);
  const commandOpen = commands.length > 0;

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

  function chooseCommand(command: ComposerCommand) {
    const leadingWhitespace = value.match(/^\s*/)?.[0] ?? "";
    onChange(`${leadingWhitespace}/${command.name} `);
    setCommandIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (commandOpen) {
      if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex(index => (index + 1) % commands.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex(index => (index - 1 + commands.length) % commands.length); return; }
      if (event.key === "Escape") { event.preventDefault(); onChange(""); return; }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); chooseCommand(commands[commandIndex] ?? commands[0]); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
  }

  return <MySurface className={`relative w-full p-3 ${dragActive ? "ring-2 ring-accent ring-offset-2" : ""}`}>
    <form onSubmit={event => { event.preventDefault(); onSend(); }} onDragEnter={event => { event.preventDefault(); if (!loading && event.dataTransfer.types.includes("Files")) setDragActive(true); }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDragLeave={event => { if (event.currentTarget === event.target) setDragActive(false); }} onDrop={event => { event.preventDefault(); setDragActive(false); if (!loading) addFiles(event.dataTransfer.files); }}>
      {files.length ? <div className="mb-3 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="待发送附件">{files.map(({ file, key }) => <div key={key} className="flex h-14 w-52 shrink-0 items-center gap-2 rounded-lg border border-default-200 bg-default-50 px-2"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-success/15 text-success"><File className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{file.name}</span><span className="block text-xs text-muted">{formatFileSize(file.size)}</span></span>{onFileRemove ? <Button isIconOnly size="sm" variant="ghost" aria-label={`移除 ${file.name}`} isDisabled={loading} onPress={() => onFileRemove(key)}><CircleXmark className="size-4" /></Button> : null}</div>)}</div> : null}
      <div className="relative">
        {commandOpen ? <div role="listbox" aria-label="DSH 命令建议" className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-default-200 bg-content1 p-1 shadow-lg">{commands.map((command, index) => <button key={command.name} type="button" role="option" aria-selected={index === commandIndex} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${index === commandIndex ? "bg-default-100" : "hover:bg-default-50"}`} onMouseDown={event => { event.preventDefault(); chooseCommand(command); }}><code className="shrink-0 text-sm font-semibold text-accent">/{command.name}</code><span className="text-sm text-muted">{command.description}</span></button>)}</div> : null}
        <TextArea ref={textareaRef} aria-label="给 Agent 发送消息" fullWidth value={value} onChange={event => { setCommandIndex(0); onChange(event.target.value); }} onKeyDown={handleKeyDown} placeholder="输入消息，或输入 / 使用 DSH 命令" rows={1} disabled={loading} className="resize-none bg-transparent" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          {onFilesSelect || onFileSelect ? <label className="cursor-pointer"><span role="button" tabIndex={loading ? -1 : 0} aria-label="添加附件" className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-default-100"><Paperclip /></span><input className="hidden" type="file" multiple disabled={loading} onChange={event => { addFiles(event.target.files); event.currentTarget.value = ""; }} /></label> : null}
          <Popover><Popover.Trigger aria-label="查看权限状态" className="inline-flex h-9 max-w-56 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-default-100"><span className="truncate">{accessLabel}</span><ChevronDown className="size-3 shrink-0" /></Popover.Trigger><Popover.Content className="max-w-xs rounded-xl border border-default-200 bg-content1 p-3 shadow-lg"><Popover.Dialog aria-label="权限状态"><div className="flex gap-2"><CircleInfo className="mt-0.5 size-4 shrink-0 text-muted" /><div><p className="text-sm font-medium">权限由平台角色授权</p><p className="mt-1 text-xs leading-5 text-muted">此处仅展示当前会话权限。为保护 AI 员工和业务数据，不能在浏览器内修改权限。</p></div></div></Popover.Dialog></Popover.Content></Popover>
        </div>
        <div className="flex shrink-0 items-center gap-1">{modelOptions.length && onModelSelect ? <Popover><Popover.Trigger className="hidden max-w-44 truncate rounded-lg px-2 py-1 text-xs text-muted hover:bg-default-100 sm:inline">{modelLabel}<ChevronDown className="ml-1 inline size-3" /></Popover.Trigger><Popover.Content className="max-h-64 w-64 overflow-auto rounded-xl border border-default-200 bg-content1 p-1 shadow-lg"><Popover.Dialog aria-label="选择模型">{modelOptions.map(option => <button key={`${option.routeId}:${option.model}`} type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-default-100" onClick={() => onModelSelect(option)}>{option.label}</button>)}</Popover.Dialog></Popover.Content></Popover> : <span className="hidden max-w-44 truncate px-2 text-xs text-muted sm:inline">{modelLabel}</span>}{running && onCancel ? <Button type="button" variant="ghost" isIconOnly aria-label="停止执行" isDisabled={loading} onPress={onCancel}><CircleStop /></Button> : null}<Button type="submit" variant="primary" isIconOnly aria-label={running ? "将消息加入当前会话队列" : "发送消息"} isDisabled={loading || !value.trim()}><PaperPlane /></Button></div>
      </div>
      {running ? <p className="mt-2 text-xs text-muted">Agent 正在执行；继续发送会加入本会话待发送消息。</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </form>
  </MySurface>;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
