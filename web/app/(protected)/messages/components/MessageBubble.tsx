import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Envelope, Paperclip } from "@gravity-ui/icons";
import { MyAvatar } from "@components/my-fields/MyAvatar";
import type { CommunicationMessageResponse } from "@features/communication/api";

export type BubbleMessage = CommunicationMessageResponse & { deliveryState?: "sending" | "failed" | "delivered" };

export function MessageBubble({
  message,
  mine,
  canRecall,
  senderName,
  senderAvatarUrl,
  onRecall,
  onReedit,
  onRetry,
  onApprovalAction,
}: {
  message: BubbleMessage;
  mine: boolean;
  canRecall: boolean;
  senderName: string;
  senderAvatarUrl?: string | null;
  onRecall: () => void;
  onReedit: () => void;
  onRetry: () => void;
  onApprovalAction: (action: "approve" | "reject") => Promise<void>;
}) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recalled = message.status === "recalled";
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  if (message.messageType === "system") {
    const card = (message.payload ?? {}) as { cardType?: string; title?: string; content?: string; actions?: Array<{ id?: string; label?: string }> };
    return <div className="self-center rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
      {card.title ? <strong className="block">{card.title}</strong> : null}
      <span>{card.content ?? message.content}</span>
      {card.cardType === "approval" && card.actions?.length ? <div className="mt-2 flex gap-2">{card.actions.filter((action) => action.id === "approve" || action.id === "reject").map((action) => <Button key={action.id} size="sm" onPress={() => void onApprovalAction(action.id as "approve" | "reject")}>{action.label ?? action.id}</Button>)}</div> : null}
    </div>;
  }
  const bubble = <div className={`relative inline-block max-w-[80%] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-start ${mine ? "border-[var(--color-primary)] bg-[var(--color-primary-soft)]" : ""}`}>
    {recalled ? <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">消息已撤回</p> : <>
      {message.messageType === "email" ? <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]"><Envelope />{message.emailSubject}</p> : null}
      <p className="m-0 whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">{message.content}</p>
      {message.attachments.map((attachment) => <a key={attachment.fileId} href={`/api/files/${attachment.fileId}/download`} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-[var(--color-primary)]">
        {attachment.isImage ? <img src={`/api/files/${attachment.fileId}/download`} alt={attachment.name} className="block max-h-64 max-w-full object-contain" /> : <Paperclip />}
        <span>{attachment.name} · {formatBytes(attachment.size)}</span>
      </a>)}
    </>}
  </div>;
  return <div className={`flex w-full items-start gap-2 ${mine ? "justify-end" : ""}`}>
    <div className={mine ? "order-2" : ""}><MyAvatar name={senderName} imageUrl={senderAvatarUrl} /></div>
    <div className={`min-w-0 w-[calc(100%-2.75rem)] ${mine ? "order-1 text-end" : ""}`}>
      <div className={`mb-1 flex items-center gap-2 text-xs text-[var(--color-text-secondary)] ${mine ? "justify-end" : ""}`}><span>{senderName}</span><time>{formatMessageTime(message.createdAt)}</time></div>
      <div onContextMenu={(event) => { if (!mine || (!canRecall && !recalled && message.deliveryState !== "failed")) return; event.preventDefault(); setMenu({ left: Math.min(event.clientX, window.innerWidth - 128), top: Math.min(event.clientY, window.innerHeight - 96) }); }}>{bubble}</div>
    </div>
    {menu ? <div ref={menuRef} role="menu" className="fixed z-50 flex flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1 shadow-[var(--shadow-floating)]" style={{ left: menu.left, top: menu.top }}>
      {message.deliveryState === "failed" ? <Button onPress={() => { setMenu(null); onRetry(); }}>重新发送</Button> : null}
      {recalled ? <Button onPress={() => { setMenu(null); onReedit(); }}>重新编辑</Button> : canRecall ? <Button onPress={() => { setMenu(null); onRecall(); }}>撤回</Button> : null}
    </div> : null}
  </div>;
}

function formatMessageTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
