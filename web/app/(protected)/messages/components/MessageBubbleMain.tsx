import type { MouseEventHandler } from "react";
import { isAttachmentOnlyMessage } from "./file-presentation";
import { MySurface } from "@shared/ui/MySurface";
import { MessageAvatar, MessageBubbleContent, type MessageBubbleProps } from "./MessageBubble";

type MainProps = MessageBubbleProps & { onContextMenu: MouseEventHandler<HTMLDivElement> };

export function MessageBubbleMain(props: MainProps) {
  return props.mine ? <MessageBubbleRight {...props} /> : <MessageBubbleLeft {...props} />;
}

function MessageBubbleLeft({ message, senderName, senderAvatarUrl, senderAvatar, children, showSenderIdentity, onContextMenu }: Pick<MainProps, "message" | "senderName" | "senderAvatarUrl" | "senderAvatar" | "children" | "showSenderIdentity" | "onContextMenu">) {
  return <div className="flex w-full min-w-0 items-start gap-2">
    <div className="size-8 shrink-0">{showSenderIdentity ? (senderAvatar ?? <MessageAvatar name={senderName} imageUrl={senderAvatarUrl} className="rounded-full shadow-lg" />) : null}</div>
    <div className="min-w-0 max-w-[calc(100%-2.5rem)]">
      {showSenderIdentity ? <div>{senderName}</div> : null}
      <div onContextMenu={onContextMenu}><MessageBubbleSurface message={message}>{children}</MessageBubbleSurface></div>
    </div>
  </div>;
}

function MessageBubbleRight({ message, senderName, senderAvatarUrl, senderAvatar, children, showSenderIdentity, onContextMenu }: Pick<MainProps, "message" | "senderName" | "senderAvatarUrl" | "senderAvatar" | "children" | "showSenderIdentity" | "onContextMenu">) {
  return <div className="flex w-full min-w-0 items-start justify-end gap-2">
    <div className="min-w-0 max-w-[calc(100%-2.5rem)] text-end" onContextMenu={onContextMenu}><MessageBubbleSurface message={message} mine>{children}</MessageBubbleSurface></div>
    <div className="size-8 shrink-0">{showSenderIdentity ? (senderAvatar ?? <MessageAvatar name={senderName} imageUrl={senderAvatarUrl} className="rounded-full shadow-lg" />) : null}</div>
  </div>;
}

function MessageBubbleSurface({ message, mine = false, children }: { message: MainProps["message"]; mine?: boolean; children?: MainProps["children"] }) {
  const attachmentOnly = children == null && isAttachmentOnlyMessage(message);
  return <MySurface className={`inline-flex w-fit max-w-full flex-col overflow-hidden rounded-md shadow-lg ${attachmentOnly ? "min-w-0 p-0" : "min-w-12 px-3 py-2"} ${mine && !attachmentOnly ? "bg-[var(--color-accent)] text-[var(--color-text-on-primary)]" : ""}`} style={{ boxShadow: "var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1))" }}>{children ?? <MessageBubbleContent message={message} />}</MySurface>;
}
