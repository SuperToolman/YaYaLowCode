"use client";

import { useRef } from "react";
import { Button, Popover, Tooltip } from "@heroui/react";
import { Envelope, FaceSmile, Paperclip, PaperPlane } from "@gravity-ui/icons";
import dynamic from "next/dynamic";
const EmojiPickerPanel = dynamic(() => import("./EmojiPickerPanel").then(module => module.EmojiPickerPanel), { ssr: false, loading: () => <span>正在加载表情…</span> });
import { ToolButton } from "./ToolButton";

type MessageSendToolbarProps = {
  disabled: boolean;
  busy: boolean;
  hasContent: boolean;
  onInsertEmoji: (emoji: string) => void;
  onFilesSelect: (files: File[]) => void;
  onOpenEmail: () => void;
  onSend: () => void;
};

export function MessageSendToolbar({
  disabled, busy, hasContent, onInsertEmoji, onFilesSelect, onOpenEmail, onSend,
}: MessageSendToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-10 shrink-0 items-center justify-between px-2">
      <div className="flex gap-1">
        <Popover>
          <Popover.Trigger>
            <Button
              variant="ghost"
              isIconOnly
              aria-label="发送表情"
              isDisabled={disabled}
            >
              <FaceSmile />
            </Button>
          </Popover.Trigger>
          <Popover.Content>
            <Popover.Dialog aria-label="选择表情">
              <EmojiPickerPanel onSelect={onInsertEmoji} />
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
        <ToolButton
          label="发送文件"
          disabled={disabled || busy}
          onPress={() => fileInput.current?.click()}
        >
          <Paperclip />
        </ToolButton>
        <ToolButton
          label="发送邮件"
          disabled={disabled || busy}
          onPress={() => onOpenEmail()}
        >
          <Envelope />
        </ToolButton>
        <input
          ref={fileInput}
          type="file"
          multiple
          disabled={disabled || busy}
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onFilesSelect(files);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <Tooltip>
        <Tooltip.Trigger>
          <Button
            variant="ghost"
            isIconOnly
            aria-label="发送消息"
            isDisabled={disabled || !hasContent || busy}
            onPress={onSend}
          >
            <PaperPlane />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>发送消息</Tooltip.Content>
      </Tooltip>
    </div>
  );
}
