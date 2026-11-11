"use client";

import { ChevronDown, CircleInfo, CircleStop, PaperPlane, Paperclip } from "@gravity-ui/icons";
import { Button, Card, Popover, Select, ListBox, Switch, Spinner } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { KnowledgeScopeSelector } from "@/features/knowledge/KnowledgeScopeSelector";
import { notify } from "@/shared/lib/notify";
import { AgentDraftEditor, type AgentDraftEditorHandle, type DraftAttachment } from "./AgentDraftEditor";

type AgentMessageComposerProps = {
  knowledgeBaseIds?: string[];
  onKnowledgeScopeChange?: (ids: string[]) => void;
  modelOptions?: {id:string;label:string}[];
  modelKey?: string;
  onModelChange?: (key:string)=>void;
  effortOptions?: string[];
  reasoningEffort?: string;
  onEffortChange?: (value:string)=>void;
  thinkingEnabled?: boolean;
  value: string;
  loading?: boolean;
  disabled?: boolean;
  running?: boolean;
  error?: string;
  attachments?: DraftAttachment[];
  sendPhase?: string;
  frozen?: boolean;
  onAbandon?: () => void;
  uploading?: boolean;
  onUpload?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
};

export function AgentMessageComposer({
  knowledgeBaseIds = [], onKnowledgeScopeChange,
  modelOptions = [], modelKey, onModelChange, effortOptions = ["auto"], reasoningEffort = "auto", onEffortChange, thinkingEnabled = false,
  value,
  loading = false,
  disabled = false,
  running = false,
  error,
  sendPhase,
  frozen = false,
  onAbandon,
  attachments = [],
  uploading = false,
  onUpload,
  onRemoveAttachment,
  onChange,
  onSend,
  onCancel,
}: AgentMessageComposerProps) {
  const editorRef = useRef<AgentDraftEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const locked = loading || disabled || uploading;

  useEffect(() => {
    if (error) notify.error(error);
  }, [error]);
  const retryFrozenSubmission =
    frozen &&
    ["发送失败，可重试", "恢复失败，可重试", "状态确认失败，可重试"].includes(
      sendPhase ?? "",
    );
  const canSend =
    !locked &&
    !running &&
    (!frozen || retryFrozenSubmission) &&
    Boolean(value.trim() || attachments.length || retryFrozenSubmission);

  function send() {
    if (canSend) onSend();
  }

  return (
    <div className="relative w-full rounded-xl bg-[var(--color-bg-subtle)] p-3 shadow-sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          if (!locked && !frozen && onUpload) setDragging(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect =
            locked || frozen || !onUpload ? "none" : "copy";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDropCapture={(event) => {
          dragDepth.current = 0;
          setDragging(false);
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          if (!locked && !frozen && onUpload) {
            editorRef.current?.prepareFileInsertion(
              event.clientX,
              event.clientY,
            );
            onUpload(Array.from(event.dataTransfer.files));
          }
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          aria-label="选择图片或文件"
          disabled={locked || !onUpload}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!locked && files.length) {
              editorRef.current?.prepareFileInsertion();
              onUpload?.(files);
            }
          }}
        />
        <AgentDraftEditor
          ref={editorRef}
          value={value}
          attachments={attachments}
          disabled={locked || frozen}
          onChange={onChange}
          onFiles={onUpload}
          onRemove={onRemoveAttachment}
          onSend={send}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1 h-full">
            <Button
              type="button"
              variant="ghost"
              isIconOnly
              aria-label="上传图片或文件"
              isDisabled={locked || !onUpload}
              isPending={uploading}
              onPress={() => fileRef.current?.click()}
            >
              <Paperclip />
            </Button>
            <Popover>
              <Button variant="ghost" size="sm" aria-label="查看权限状态">
                <span className="truncate">用户权限与员工能力</span>
                <ChevronDown />
              </Button>
              <Popover.Content>
                <Popover.Dialog aria-label="权限状态">
                  <Card>
                    <Card.Header>
                      <CircleInfo />
                      <Card.Title>权限由平台角色授权</Card.Title>
                    </Card.Header>
                    <Card.Content>
                      当前会话受用户权限与员工能力共同限制。
                    </Card.Content>
                  </Card>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {frozen && onAbandon && (
              <Button type="button" variant="ghost" size="sm" onPress={onAbandon}>
                放弃本次发送
              </Button>
            )}
            {onKnowledgeScopeChange && <KnowledgeScopeSelector selected={knowledgeBaseIds} onChange={onKnowledgeScopeChange} disabled={locked || frozen} />}
            <Select placeholder="请配置模型" aria-label="对话模型" selectedKey={modelKey ?? null} onSelectionChange={key=>{if(key!==null)onModelChange?.(String(key));}} isDisabled={locked || frozen || !modelOptions.length} className="min-w-0 max-w-64">
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{modelOptions.map(option=><ListBox.Item key={option.id} id={option.id} textValue={option.label}>{option.label}</ListBox.Item>)}</ListBox></Select.Popover>
            </Select>
            {thinkingEnabled && effortOptions.every(value=>["auto","off"].includes(value)) ? <Switch aria-label="思考模式" isSelected={reasoningEffort!=="off"} onChange={selected=>onEffortChange?.(selected?"auto":"off")} isDisabled={locked || frozen || !effortOptions.includes("off")}><Switch.Control><Switch.Thumb /></Switch.Control><Switch.Content>思考</Switch.Content></Switch> : thinkingEnabled && <Select aria-label="思考强度" selectedKey={reasoningEffort} onSelectionChange={key=>{if(key!==null)onEffortChange?.(String(key));}} isDisabled={locked || frozen || effortOptions.length<2} className="min-w-0 max-w-40">
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{effortOptions.map(value=><ListBox.Item key={value} id={value} textValue={({auto:"思考：自动",off:"关闭思考",ultra:"思考：超高",extreme:"思考：极致",low:"思考：低",medium:"思考：中",high:"思考：高",max:"思考：最高"} as Record<string,string>)[value]}>{({auto:"思考：自动",off:"关闭思考",ultra:"思考：超高",extreme:"思考：极致",low:"思考：低",medium:"思考：中",high:"思考：高",max:"思考：最高"} as Record<string,string>)[value]}</ListBox.Item>)}</ListBox></Select.Popover>
            </Select>}
            {running && (
              <Button
                type="button"
                variant="ghost"
                isIconOnly
                aria-label="停止执行"
                isDisabled={locked}
                onPress={onCancel}
              >
                <CircleStop />
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              isIconOnly
              aria-label={uploading ? "正在上传附件" : loading ? "正在提交消息" : "发送消息"}
              isDisabled={!canSend}
            >
              {uploading || loading ? <Spinner size="sm" /> : <PaperPlane />}
            </Button>
          </div>
        </div>
      </form>
      {dragging && !locked && !frozen ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-[var(--color-bg-subtle)]/95 text-sm text-app-primary shadow-lg"
          role="status"
        >
          <Paperclip className="size-5" aria-hidden="true" />
          松开以添加图片或文件
        </div>
      ) : null}
    </div>
  );
}
