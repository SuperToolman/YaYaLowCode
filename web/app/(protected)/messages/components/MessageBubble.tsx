import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { Envelope } from "@gravity-ui/icons";
import { MyAvatar } from "@components/my-fields/MyAvatar";
import type { CommunicationMessageResponse } from "@features/communication/api";
import { isAttachmentOnlyMessage } from "./file-presentation";
import { MessageFile } from "./MessageFile";
import { MessageImage } from "./MessageImage";
import { MessageBubbleMain } from "./MessageBubbleMain";

export type BubbleMessage = CommunicationMessageResponse & {
  deliveryState?: "sending" | "failed" | "delivered";
};
export type MessageBubbleProps = {
  message: BubbleMessage;
  mine: boolean;
  showSenderIdentity: boolean;
  canRecall: boolean;
  senderName: string;
  senderAvatarUrl?: string | null;
  senderAvatar?: ReactNode;
  children?: ReactNode;
  onRecall: () => void;
  onReedit: () => void;
  onRetry: () => void;
  onApprovalAction: (action: "approve" | "reject") => Promise<void>;
};

export function MessageBubble(props: MessageBubbleProps) {
  const {
    message,
    mine,
    canRecall,
    onRecall,
    onReedit,
    onRetry,
  } = props;
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recalled = message.status === "recalled";
  const canOpenActions =
    mine && (canRecall || recalled || message.deliveryState === "failed");
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  return (
    <>
      <MessageBubbleMain
        {...props}
        onContextMenu={(event) => {
          if (!canOpenActions) return;
          event.preventDefault();
          setMenu({
            left: Math.min(event.clientX, window.innerWidth - 128),
            top: Math.min(event.clientY, window.innerHeight - 96),
          });
        }}
      />
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 flex flex-col"
          style={{ left: menu.left, top: menu.top }}
        >
          {message.deliveryState === "failed" ? (
            <Button
              onPress={() => {
                setMenu(null);
                onRetry();
              }}
            >
              重新发送
            </Button>
          ) : null}
          {recalled ? (
            <Button
              onPress={() => {
                setMenu(null);
                onReedit();
              }}
            >
              重新编辑
            </Button>
          ) : canRecall ? (
            <Button
              onPress={() => {
                setMenu(null);
                onRecall();
              }}
            >
              撤回
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function MessageBubbleContent({ message }: { message: BubbleMessage }) {
  if (message.status === "recalled") return <p>消息已撤回</p>;
  return (
    <>
      {message.messageType === "email" ? (
        <p>
          <Envelope />
          {message.emailSubject}
        </p>
      ) : null}
      {!isAttachmentOnlyMessage(message) && message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
      <MessageAttachments message={message} />
    </>
  );
}

export function MessageAttachments({ message }: { message: BubbleMessage }) {
  if (message.status === "recalled") return null;
  return <>{message.attachments.map(attachment => attachment.isImage || attachment.mimeType.startsWith("image/") ?
    <MessageImage key={attachment.fileId} imageId={`${message.id}:${attachment.fileId}`} src={`/api/files/${attachment.fileId}/download`} alt={attachment.name} /> :
    <MessageFile key={attachment.fileId} attachment={attachment} />
  )}</>;
}

export function MessageAvatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
}) {
  return (
    <MyAvatar
      name={name}
      imageUrl={imageUrl}
      className={className}
      style={{ borderRadius: "50%", boxShadow: "var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1))" }}
    />
  );
}
